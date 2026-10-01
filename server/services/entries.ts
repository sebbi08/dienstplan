import { and, eq } from 'drizzle-orm'
import { breakConflict } from '../../shared/domain/breaks'
import { cellKey } from '../../shared/domain/cells'
import { describeCellDetailed } from '../../shared/domain/describe'
import { isValidIsoDate } from '../../shared/domain/dates'
import { validateSpan } from '../../shared/domain/time'
import type { IsoDate } from '../../shared/domain/types'
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
  const unique = [...new Map(cells.map(cell => [cellKey(cell.employeeId, cell.date), cell])).values()]

  db.transaction((tx) => {
    for (const cell of unique) {
      if (!employeeIds.has(cell.employeeId)) throw new ServiceError(400, 'employee_not_found')
      if (!isValidIsoDate(cell.date)) throw new ServiceError(400, 'invalid_date')
      const before = describeCellAt(tx, cell)
      if (mode !== 'add') {
        tx.delete(entries).where(and(eq(entries.employeeId, cell.employeeId), eq(entries.date, cell.date))).run()
      }
      if (values?.kind === 'break') {
        const conflict = breakConflict(loadEntries(tx, { employeeId: cell.employeeId, from: cell.date, to: cell.date }), values.start!, values.end!)
        if (conflict) throw new ServiceError(400, conflict)
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

/** Changes (or removes, with nulls) the break of one working entry; the entry itself stays as it is. */
export function updateEntryBreak(
  db: Db, actor: SessionUser, id: number, breakStart: number | null, breakEnd: number | null, now: Date = new Date(),
): void {
  const entry = db.select().from(entries).where(eq(entries.id, id)).get()
  if (!entry) throw new ServiceError(404, 'entry_not_found')
  if (entry.kind === 'break' || entry.start === null || entry.end === null) throw new ServiceError(400, 'not_a_work_entry')
  const spanError = validateSpan({ start: entry.start, end: entry.end, breakStart, breakEnd })
  if (spanError) throw new ServiceError(400, `span_${spanError}`)

  const cell = { employeeId: entry.employeeId, date: entry.date }
  db.transaction((tx) => {
    const dayEntries = loadEntries(tx, { employeeId: cell.employeeId, from: cell.date, to: cell.date })
    if (breakStart !== null && breakEnd !== null) {
      const self = dayEntries.find(candidate => candidate.id === id)
      const conflict = breakConflict(dayEntries, breakStart, breakEnd, { ignoreBreakOf: self })
      if (conflict) throw new ServiceError(400, conflict)
    }
    const before = describeCellDetailed(dayEntries)
    tx.update(entries).set({ breakStart, breakEnd, updatedAt: now.toISOString(), updatedBy: actor.id })
      .where(eq(entries.id, id)).run()
    logChange(tx, {
      ...cell, field: 'entry', before, after: describeCellAt(tx, cell), actorId: actor.id, now: now.toISOString(),
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
