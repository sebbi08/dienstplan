import { and, eq, gte, inArray } from 'drizzle-orm'
import { breakConflict } from '../../shared/domain/breaks'
import { cellKey } from '../../shared/domain/cells'
import { describeCellDetailed } from '../../shared/domain/describe'
import { isValidIsoDate } from '../../shared/domain/dates'
import { validateSpan, type TimeSpan } from '../../shared/domain/time'
import { isTargetGapCode, TARGET_GAP_CODES } from '../../shared/domain/warnings'
import type { DomainEntry, IsoDate, Minutes } from '../../shared/domain/types'
import type { ApplyMode, CellRef, EntryDto, EntryInput, NoteField, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, dayNotes, employees, entries, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { isHelperOn } from './helpOuts'
import { inPlanOf, loadEntries } from './queries'

type ResolvedEntry = Omit<typeof entries.$inferInsert, 'employeeId' | 'date' | 'updatedAt' | 'updatedBy' | 'closureId'>

const NO_TIMES = { start: null, end: null, breakStart: null, breakEnd: null }

export function resolveEntry(db: Db, facilityId: number, input: EntryInput): ResolvedEntry {
  const note = input.note?.trim() || null

  if (input.kind === 'shift') {
    const template = db.select().from(shiftTemplates)
      .where(and(eq(shiftTemplates.id, input.templateId ?? -1), eq(shiftTemplates.facilityId, facilityId))).get()
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

/** Ids of the employees whose home facility is facilityId. */
function facilityEmployeeIds(db: Db, facilityId: number): Set<number> {
  return new Set(db.select({ id: employees.id }).from(employees).where(eq(employees.facilityId, facilityId)).all()
    .map(row => row.id))
}

/**
 * Which plan the person's day belongs to (one day, one facility): the facility of its help-out entries, 'home' for
 * home entries, null when the day is empty.
 */
export function cellOwner(db: Db, employeeId: number, date: IsoDate): number | null | 'home' {
  const rows = db.select({ helpFacilityId: entries.helpFacilityId }).from(entries)
    .where(and(eq(entries.employeeId, employeeId), eq(entries.date, date))).all()
  if (rows.length === 0) return null
  return rows.find(row => row.helpFacilityId !== null)?.helpFacilityId ?? 'home'
}

/**
 * Writes into plan cells of the facility; if any cell is refused, nothing is written. A cell is accepted when
 * 1. its employee is home staff and the day is no help-out elsewhere;
 * 2. its employee is home staff, the day is a help-out elsewhere and the input is an absence: the help-out is replaced
 *    (logged in both facilities); anything else gives cell_helps_elsewhere;
 * 3. its employee is a helper of the facility that month and the day belongs to no other plan (else cell_taken): the
 *    entries are planned here (help_facility_id); absences give help_code_not_allowed.
 * Anyone else gives employee_not_found.
 */
export function applyToCells(
  db: Db, actor: SessionUser, facilityId: number, cells: CellRef[], mode: ApplyMode, input: EntryInput | null,
  options: { now?: Date; closureId?: number | null } = {},
): void {
  if (mode !== 'clear' && !input) throw new ServiceError(400, 'entry_required')
  const own = facilityEmployeeIds(db, facilityId)
  const isHelperCell = (cell: CellRef) => !own.has(cell.employeeId)
  if (cells.some(cell => isHelperCell(cell) && !isHelperOn(db, facilityId, cell.employeeId, cell.date))) {
    throw new ServiceError(400, 'employee_not_found')
  }
  const values = mode === 'clear' ? null : resolveEntry(db, facilityId, input!)
  if (values?.kind === 'break' && mode !== 'add') throw new ServiceError(400, 'break_requires_add')
  const now = (options.now ?? new Date()).toISOString()
  const gapCodeIds = new Set(db.select({ id: absenceCodes.id }).from(absenceCodes)
    .where(inArray(absenceCodes.key, TARGET_GAP_CODES)).all().map(row => row.id))
  const isGapCode = values?.absenceCodeId != null && gapCodeIds.has(values.absenceCodeId)
  // An absence is any code other than the timed VZ/Büro (Urlaub, Krank, Fortbildung, Schließtag …, with or without times).
  const isAbsence = values?.kind === 'code' && !isGapCode
  if (isAbsence && cells.some(isHelperCell)) throw new ServiceError(400, 'help_code_not_allowed')
  const unique = [...new Map(cells.map(cell => [cellKey(cell.employeeId, cell.date), cell])).values()]

  db.transaction((tx) => {
    for (const cell of unique) {
      if (!isValidIsoDate(cell.date)) throw new ServiceError(400, 'invalid_date')
      const cellFilter = { employeeId: cell.employeeId, from: cell.date, to: cell.date }
      const helper = isHelperCell(cell)
      const owner = cellOwner(tx, cell.employeeId, cell.date)
      const before = describeCellAt(tx, cell)
      if (helper && owner !== null && owner !== facilityId) throw new ServiceError(409, 'cell_taken')
      if (!helper && typeof owner === 'number') {
        if (!isAbsence) throw new ServiceError(409, 'cell_helps_elsewhere')
        // The absence replaces the help-out; the other plan sees its cell emptied.
        tx.delete(entries).where(and(eq(entries.employeeId, cell.employeeId), eq(entries.date, cell.date))).run()
        logChange(tx, {
          facilityId: owner, date: cell.date, employeeId: cell.employeeId, field: 'entry',
          before, after: describeCellAt(tx, cell), actorId: actor.id, now,
        })
      }
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
          ...values, employeeId: cell.employeeId, date: cell.date, helpFacilityId: helper ? facilityId : null,
          closureId: options.closureId ?? null, updatedAt: now, updatedBy: actor.id,
        }).run()
      }
      logChange(tx, {
        facilityId, date: cell.date, employeeId: cell.employeeId, field: 'entry',
        before, after: describeCellAt(tx, cell), actorId: actor.id, now,
      })
    }
  })
}

/**
 * An entry in the facility's plan (its staff's home entries and its helpers' entries planned here); 404
 * entry_not_found for any other id, including its staff's help-outs elsewhere.
 */
function requireOwnEntry(db: Db, facilityId: number, id: number): typeof entries.$inferSelect {
  const row = db.select({ entry: entries }).from(entries).innerJoin(employees, eq(entries.employeeId, employees.id))
    .where(and(eq(entries.id, id), inPlanOf(facilityId))).get()
  if (!row) throw new ServiceError(404, 'entry_not_found')
  return row.entry
}

export function deleteEntry(db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date()): void {
  const entry = requireOwnEntry(db, facilityId, id)
  const cell = { employeeId: entry.employeeId, date: entry.date }
  db.transaction((tx) => {
    const before = describeCellAt(tx, cell)
    tx.delete(entries).where(eq(entries.id, id)).run()
    logChange(tx, {
      facilityId, ...cell, field: 'entry', before, after: describeCellAt(tx, cell), actorId: actor.id, now: now.toISOString(),
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
export function dayConflict(day: DomainEntry[], changed: DomainEntry): string | null {
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
export function updateEntryTimes(
  db: Db, actor: SessionUser, facilityId: number, id: number, change: EntryTimesChange, now: Date = new Date(),
): void {
  const entry = requireOwnEntry(db, facilityId, id)
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
      facilityId, ...cell, field: 'entry', before: describeCellDetailed(dayEntries), after: describeCellAt(tx, cell),
      actorId: actor.id, now: now.toISOString(),
    })
  })
}

/** Sets one of the two info lines of a day in the facility's plan. */
export function setDayNote(
  db: Db, actor: SessionUser, facilityId: number, date: IsoDate, field: NoteField, value: string, now: Date = new Date(),
): void {
  if (!isValidIsoDate(date)) throw new ServiceError(400, 'invalid_date')
  const text = value.trim()
  const values = field === 'info1' ? { info1: text } : { info2: text }
  db.transaction((tx) => {
    const existing = tx.select().from(dayNotes).where(and(eq(dayNotes.facilityId, facilityId), eq(dayNotes.date, date))).get()
    const before = existing?.[field] ?? ''
    tx.insert(dayNotes).values({ facilityId, date, ...values })
      .onConflictDoUpdate({ target: [dayNotes.facilityId, dayNotes.date], set: values }).run()
    logChange(tx, { facilityId, date, employeeId: null, field, before, after: text, actorId: actor.id, now: now.toISOString() })
  })
}

/**
 * After a service (Dienst) of the facility got new times: its fixed shifts in the facility's plan (helpers' included) from `from` on
 * that still have the old times get the new ones.
 * Earlier days and individually changed shifts stay as they are; a cell where the new times would clash with other
 * entries (e.g. VZ inside the shift or an extra break) is left alone and counted as skipped.
 */
export function adoptShiftTimes(
  db: Db, actor: SessionUser, facilityId: number, shiftTemplateId: number, oldTimes: TimeSpan, newTimes: TimeSpan,
  from: IsoDate, now: Date = new Date(),
): { updated: number; skipped: number } {
  const result = { updated: 0, skipped: 0 }
  const timestamp = now.toISOString()
  const outdated = db.select({ entry: entries }).from(entries).innerJoin(employees, eq(entries.employeeId, employees.id))
    .where(and(
      eq(entries.shiftTemplateId, shiftTemplateId), eq(entries.kind, 'shift'), gte(entries.date, from),
      inPlanOf(facilityId),
    )).all().map(row => row.entry).filter(entry => entry.start === oldTimes.start && entry.end === oldTimes.end
    && entry.breakStart === oldTimes.breakStart && entry.breakEnd === oldTimes.breakEnd)
  db.transaction((tx) => {
    for (const entry of outdated) {
      const cell = { employeeId: entry.employeeId, date: entry.date }
      const day = loadEntries(tx, { employeeId: cell.employeeId, from: cell.date, to: cell.date })
      const self = day.find(candidate => candidate.id === entry.id)!
      const changed: EntryDto = { ...self, ...newTimes }
      if (dayConflict(day.map(candidate => (candidate === self ? changed : candidate)), changed)) {
        result.skipped += 1
        continue
      }
      tx.update(entries).set({ ...newTimes, updatedAt: timestamp, updatedBy: actor.id }).where(eq(entries.id, entry.id)).run()
      logChange(tx, {
        facilityId, ...cell, field: 'entry', before: describeCellDetailed(day), after: describeCellAt(tx, cell), actorId: actor.id, now: timestamp,
      })
      result.updated += 1
    }
  })
  return result
}
