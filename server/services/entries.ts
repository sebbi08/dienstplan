import { and, eq, inArray } from 'drizzle-orm'
import { breakConflict } from '../../shared/domain/breaks'
import { cellKey } from '../../shared/domain/cells'
import { describeCellDetailed } from '../../shared/domain/describe'
import { isValidIsoDate } from '../../shared/domain/dates'
import { validateSpan } from '../../shared/domain/time'
import { isTargetGapCode, TARGET_GAP_CODES } from '../../shared/domain/warnings'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import type { ApplyMode, CellRef, EntryDto, EntryInput, NoteField, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, dayNotes, employees, entries, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { loadEntries } from './queries'

type ResolvedEntry = Omit<typeof entries.$inferInsert, 'employeeId' | 'date' | 'updatedAt' | 'updatedBy' | 'closureId'>

const NO_TIMES = { start: null, end: null, breakStart: null, breakEnd: null }

export function resolveEntry(db: Db, input: EntryInput): ResolvedEntry {
  const note = input.note?.trim() || null

  if (input.kind === 'shift') {
    const template = db.select().from(shiftTemplates).where(eq(shiftTemplates.id, input.templateId ?? -1)).get()
    if (!template) throw new ServiceError(400, 'template_not_found')
    return {
      kind: 'shift', shiftTemplateId: template.id, absenceCodeId: null,
      start: template.start, end: template.end, breakStart: template.breakStart, breakEnd: template.breakEnd,
      countsAsStaff: template.countsAsStaff, note,
    }
  }

  const isBreak = input.kind === 'break'
  const span = {
    start: input.start ?? null, end: input.end ?? null,
    breakStart: isBreak ? null : input.breakStart ?? null, breakEnd: isBreak ? null : input.breakEnd ?? null,
  }
  const hasTimes = span.start !== null && span.end !== null
  if (!hasTimes && (span.start !== null || span.end !== null)) throw new ServiceError(400, 'span_incomplete')
  if (hasTimes) {
    const error = validateSpan({ start: span.start!, end: span.end!, breakStart: span.breakStart, breakEnd: span.breakEnd })
    if (error) throw new ServiceError(400, `span_${error}`)
  }

  if (input.kind === 'special' || isBreak) {
    if (!hasTimes) throw new ServiceError(400, 'times_required')
    return { kind: input.kind, shiftTemplateId: null, absenceCodeId: null, ...span, countsAsStaff: !isBreak, note }
  }

  const code = db.select().from(absenceCodes).where(eq(absenceCodes.id, input.codeId ?? -1)).get()
  if (!code) throw new ServiceError(400, 'code_not_found')
  if (code.requiresTimes && !hasTimes) throw new ServiceError(400, 'times_required')
  return {
    kind: 'code', shiftTemplateId: null, absenceCodeId: code.id,
    ...(hasTimes ? span : NO_TIMES), countsAsStaff: true, note,
  }
}

export function describeCellAt(db: Db, cell: CellRef): string {
  return describeCellDetailed(loadEntries(db, { employeeId: cell.employeeId, from: cell.date, to: cell.date }))
}

export function applyToCells(
  db: Db, actor: SessionUser, cells: CellRef[], mode: ApplyMode, input: EntryInput | null,
  options: { now?: Date; closureId?: number | null } = {},
): void {
  if (mode !== 'clear' && !input) throw new ServiceError(400, 'entry_required')
  const values = mode === 'clear' ? null : resolveEntry(db, input!)
  if (values?.kind === 'break' && mode !== 'add') throw new ServiceError(400, 'break_requires_add')
  const now = (options.now ?? new Date()).toISOString()
  const employeeIds = new Set(db.select({ id: employees.id }).from(employees).all().map(row => row.id))
  const gapCodeIds = new Set(db.select({ id: absenceCodes.id }).from(absenceCodes)
    .where(inArray(absenceCodes.key, TARGET_GAP_CODES)).all().map(row => row.id))
  const isGapCode = values?.absenceCodeId != null && gapCodeIds.has(values.absenceCodeId)
  const unique = [...new Map(cells.map(cell => [cellKey(cell.employeeId, cell.date), cell])).values()]

  db.transaction((tx) => {
    for (const cell of unique) {
      if (!employeeIds.has(cell.employeeId)) throw new ServiceError(400, 'employee_not_found')
      if (!isValidIsoDate(cell.date)) throw new ServiceError(400, 'invalid_date')
      const cellFilter = { employeeId: cell.employeeId, from: cell.date, to: cell.date }
      const before = describeCellAt(tx, cell)
      if (mode !== 'add') {
        // Entering a shift into a cell with VZ/Büro adds it next to them instead of removing them.
        const keepTimedCodes = mode === 'replace' && (values?.kind === 'shift' || values?.kind === 'special')
        for (const existing of loadEntries(tx, cellFilter)) {
          const kept = keepTimedCodes && existing.start !== null && isTargetGapCode(existing.codeKey)
          if (!kept) tx.delete(entries).where(eq(entries.id, existing.id)).run()
        }
      }
      if (values?.kind === 'break') {
        const conflict = breakConflict(loadEntries(tx, cellFilter), values.start!, values.end!)
        if (conflict) throw new ServiceError(400, conflict)
      }
      else if (values && values.start != null && values.end != null) {
        // Only VZ/Büro may overlap a working entry (e.g. VZ inside a full shift); working times counted once.
        const { start, end } = values
        const overlapping = loadEntries(tx, cellFilter).some(other => other.kind !== 'break'
          && other.start !== null && other.end !== null && start < other.end && other.start < end
          && isTargetGapCode(other.codeKey) === isGapCode)
        if (overlapping) throw new ServiceError(400, 'entries_overlap')
      }
      if (values) {
        tx.insert(entries).values({
          ...values, employeeId: cell.employeeId, date: cell.date,
          closureId: options.closureId ?? null, updatedAt: now, updatedBy: actor.id,
        }).run()
      }
      logChange(tx, {
        date: cell.date, employeeId: cell.employeeId, field: 'entry',
        before, after: describeCellAt(tx, cell), actorId: actor.id, now,
      })
    }
  })
}

export function deleteEntry(db: Db, actor: SessionUser, id: number, now: Date = new Date()): void {
  const entry = db.select().from(entries).where(eq(entries.id, id)).get()
  if (!entry) throw new ServiceError(404, 'entry_not_found')
  const cell = { employeeId: entry.employeeId, date: entry.date }
  db.transaction((tx) => {
    const before = describeCellAt(tx, cell)
    tx.delete(entries).where(eq(entries.id, id)).run()
    logChange(tx, {
      ...cell, field: 'entry', before, after: describeCellAt(tx, cell), actorId: actor.id, now: now.toISOString(),
    })
  })
}

export interface EntryTimesChange {
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
}

/** First rule a day breaks after entry `changed` got new times: overlapping work or a misplaced break. */
function dayConflict(day: EntryDto[], changed: EntryDto): string | null {
  if (changed.kind !== 'break') {
    const overlapping = day.some(other => other !== changed && other.kind !== 'break' && other.start !== null && other.end !== null
      && changed.start! < other.end && other.start < changed.end!
      && isTargetGapCode(other.codeKey) === isTargetGapCode(changed.codeKey))
    if (overlapping) return 'entries_overlap'
  }
  for (const entry of day) {
    const conflict = entry.kind === 'break'
      ? breakConflict(day.filter(other => other !== entry), entry.start!, entry.end!)
      : entry.breakStart !== null && entry.breakEnd !== null
        ? breakConflict(day, entry.breakStart, entry.breakEnd, { ignoreBreakOf: entry })
        : null
    if (conflict) return conflict
  }
  return null
}

/**
 * Changes the times of one timed entry (clicked in the plan). A fixed shift whose start or end changes
 * becomes a special shift; a fixed shift with only a changed break stays a fixed shift.
 */
export function updateEntryTimes(db: Db, actor: SessionUser, id: number, change: EntryTimesChange, now: Date = new Date()): void {
  const entry = db.select().from(entries).where(eq(entries.id, id)).get()
  if (!entry) throw new ServiceError(404, 'entry_not_found')
  if (entry.start === null || entry.end === null) throw new ServiceError(400, 'not_a_timed_entry')
  const isBreak = entry.kind === 'break'
  const span = { ...change, breakStart: isBreak ? null : change.breakStart, breakEnd: isBreak ? null : change.breakEnd }
  const spanError = validateSpan(span)
  if (spanError) throw new ServiceError(400, `span_${spanError}`)
  const becomesSpecial = entry.kind === 'shift' && (span.start !== entry.start || span.end !== entry.end)

  const cell = { employeeId: entry.employeeId, date: entry.date }
  db.transaction((tx) => {
    const dayEntries = loadEntries(tx, { employeeId: cell.employeeId, from: cell.date, to: cell.date })
    const self = dayEntries.find(candidate => candidate.id === id)!
    const changed: EntryDto = { ...self, ...span, kind: becomesSpecial ? 'special' : self.kind }
    const conflict = dayConflict(dayEntries.map(candidate => (candidate === self ? changed : candidate)), changed)
    if (conflict) throw new ServiceError(400, conflict)

    tx.update(entries).set({
      ...span, ...(becomesSpecial ? { kind: 'special' as const, shiftTemplateId: null } : {}),
      updatedAt: now.toISOString(), updatedBy: actor.id,
    }).where(eq(entries.id, id)).run()
    logChange(tx, {
      ...cell, field: 'entry', before: describeCellDetailed(dayEntries), after: describeCellAt(tx, cell),
      actorId: actor.id, now: now.toISOString(),
    })
  })
}

export function setDayNote(
  db: Db, actor: SessionUser, date: IsoDate, field: NoteField, value: string, now: Date = new Date(),
): void {
  if (!isValidIsoDate(date)) throw new ServiceError(400, 'invalid_date')
  const text = value.trim()
  const values = field === 'info1' ? { info1: text } : { info2: text }
  db.transaction((tx) => {
    const existing = tx.select().from(dayNotes).where(eq(dayNotes.date, date)).get()
    const before = existing?.[field] ?? ''
    tx.insert(dayNotes).values({ date, ...values })
      .onConflictDoUpdate({ target: dayNotes.date, set: values }).run()
    logChange(tx, { date, employeeId: null, field, before, after: text, actorId: actor.id, now: now.toISOString() })
  })
}
