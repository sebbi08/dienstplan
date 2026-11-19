import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { dateRange, daysBetween } from '../../shared/domain/dates'
import { isHolidayIn, type HolidayRules } from '../../shared/domain/holidays'
import { countLeaveDays, countsAsLeaveDay } from '../../shared/domain/leave'
import { PROTECTED_CODE_KEYS } from '../../shared/domain/maternity'
import { isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureDto, ClosureListItemDto, ClosureMode, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, employees, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { closureCodeId, splitLeave } from './closureBooking'
import { applyToCells, cellOwner, describeCellAt } from './entries'
import { groupNames } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { getLeaveCounting } from './leaveCounting'
import { closureColumns, loadClosures, loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'
import { deleteExpiredUnlocks } from './tabletNoLock'

export interface ClosureInput {
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

/**
 * The leave days the dates use for staff working Monday to Friday: weekends and the facility's public holidays left
 * out, 24 and 31 December by the facility setting (the closures page's „Urlaubstage“, the closure leave preview).
 */
export function fiveDayWeekLeaveDays(dates: IsoDate[], rules: HolidayRules, halfOnEves: boolean): number {
  return countLeaveDays(dates.filter(date => countsAsLeaveDay(date, rules)), halfOnEves)
}

/** The facility's closures, each with the leave days it uses for staff working Monday to Friday. */
export function listClosures(db: Db, facilityId: number): ClosureListItemDto[] {
  const rules = facilityHolidayRules(db, facilityId)
  const { christmasEveHalfLeave } = getLeaveCounting(db, facilityId)
  return loadClosures(db, facilityId).map(closure => ({
    ...closure,
    leaveDays: closure.mode === 'vacation'
      ? fiveDayWeekLeaveDays(dateRange(closure.startDate, closure.endDate), rules, christmasEveHalfLeave)
      : null,
  }))
}

interface BookingScope {
  /** Only days from then on. */
  from?: IsoDate
  /** Only the days this accepts, and only cells that are still empty (nothing is overwritten). */
  onlyEmpty?: (employeeId: number, date: IsoDate) => boolean
}

type Cell = { employeeId: number; date: IsoDate }

/**
 * Books a closure of the facility for the given staff (all of that facility), only on each one's working days
 * (a closure never uses leave on a day off) and, with `from`, only on days from then on. Days on which someone helps
 * out in another facility are skipped (and booked when that help-out day becomes empty again, see rebookHomeClosure).
 * Someone who moved into the facility (facilitySince set) gets it only from that day on: the days before belong to the
 * other facility, so nothing there is booked or replaced. Days holding Mutterschutz or Beschäftigungsverbot are skipped
 * for everyone: the protection comes first, no leave is used in it (§ 24 MuSchG), and a closure manager without the
 * right is neither refused nor told about it. Returns the cells booked.
 */
function bookClosure(
  db: Db, actor: SessionUser, facilityId: number, closure: ClosureDto, staff: EmployeeRecord[], now: Date,
  { from, onlyEmpty }: BookingScope = {},
): Cell[] {
  const vacationCells: Cell[] = []
  const closureCells: Cell[] = []
  const movedIn = new Map(db.select({ id: employees.id, since: employees.facilitySince }).from(employees)
    .where(inArray(employees.id, staff.map(employee => employee.id))).all().map(row => [row.id, row.since]))
  const protectedCells = new Set(staff.length === 0
    ? []
    : db.select({ employeeId: entries.employeeId, date: entries.date }).from(entries)
        .innerJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
        .where(and(
          inArray(absenceCodes.key, [...PROTECTED_CODE_KEYS]), inArray(entries.employeeId, staff.map(employee => employee.id)),
          gte(entries.date, closure.startDate), lte(entries.date, closure.endDate),
        )).all().map(row => `${row.employeeId}|${row.date}`))
  for (const employee of staff) {
    const since = movedIn.get(employee.id) ?? null
    const free = (date: IsoDate) => onlyEmpty
      ? onlyEmpty(employee.id, date) && cellOwner(db, employee.id, date) === null
      : typeof cellOwner(db, employee.id, date) !== 'number'
    const dates = dateRange(closure.startDate, closure.endDate)
      .filter(date => isWorkday(employee.info, date) && (from === undefined || date >= from) && (since === null || date >= since)
        && !protectedCells.has(`${employee.id}|${date}`) && free(date))
    const split = closure.mode === 'vacation' ? splitLeave(db, employee, dates) : { vacation: [], closureDays: dates }
    vacationCells.push(...split.vacation.map(date => ({ employeeId: employee.id, date })))
    closureCells.push(...split.closureDays.map(date => ({ employeeId: employee.id, date })))
  }
  const options = { now, closureId: closure.id }
  if (vacationCells.length) applyToCells(db, actor, facilityId, vacationCells, 'replace', { kind: 'code', codeId: closureCodeId(db, 'vacation') }, options)
  if (closureCells.length) applyToCells(db, actor, facilityId, closureCells, 'replace', { kind: 'code', codeId: closureCodeId(db, 'closure_day') }, options)
  return [...vacationCells, ...closureCells]
}

/** The trimmed label of a valid closure input: a label, and an end on or after the start and at most 366 days later. */
function checkedLabel(input: ClosureInput): string {
  const label = input.label.trim()
  if (!label) throw new ServiceError(400, 'label_required')
  const length = daysBetween(input.startDate, input.endDate)
  if (length < 0 || length > 366) throw new ServiceError(400, 'invalid_range')
  return label
}

/** Creates a closure of the facility and books it for the facility's staff. */
export function createClosure(
  db: Db, actor: SessionUser, facilityId: number, input: ClosureInput, now: Date = new Date(),
): ClosureDto {
  const label = checkedLabel(input)
  return db.transaction((tx) => {
    deleteExpiredUnlocks(tx, now)
    const closure = tx.insert(closures)
      .values({ facilityId, startDate: input.startDate, endDate: input.endDate, label, mode: input.mode })
      .returning(closureColumns).get()
    bookClosure(tx, actor, facilityId, closure, loadEmployees(tx, facilityId), now)
    return closure
  })
}

/**
 * Books all existing closures of the employee's facility for one (new) employee, so closures apply to everyone
 * regardless of when they joined. With `from` (someone moving in), only closure days from then on are booked.
 */
export function bookClosuresFor(db: Db, actor: SessionUser, employeeId: number, now: Date = new Date(), from?: IsoDate): void {
  const employee = loadEmployee(db, employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  for (const closure of loadClosures(db, employee.facilityId)) {
    if (from !== undefined && closure.endDate < from) continue
    bookClosure(db, actor, employee.facilityId, closure, [employee], now, { from })
  }
}

/**
 * Books the closures of the employee's facility for them on the days from `from` (before `until` when given, exclusive),
 * as creating the closure would have (working days only, leave in vacation mode with the joiner limit, help-out days
 * skipped), but only in cells that are still empty: nothing is overwritten, so running it again books nothing new.
 * Someone who moved into the facility (facilitySince set, see moveEmployeeToFacility) gets them only from that day on:
 * the days before belong to the other facility. A facilitySince of null means the person belongs to the facility from
 * the start, so all their days are its own and nothing has to be moved. Returns the number of days booked.
 */
export function bookClosuresBetween(
  db: Db, actor: SessionUser, employeeId: number, from: IsoDate, until: IsoDate | null, now: Date = new Date(),
): number {
  const employee = loadEmployee(db, employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const since = db.select({ since: employees.facilitySince }).from(employees).where(eq(employees.id, employeeId)).get()?.since
  const start = since != null && since > from ? since : from
  const onlyEmpty = (_employeeId: number, date: IsoDate) => date >= start && (until === null || date < until)
  let booked = 0
  for (const closure of loadClosures(db, employee.facilityId)) {
    if (closure.endDate < start || (until !== null && closure.startDate >= until)) continue
    booked += bookClosure(db, actor, employee.facilityId, closure, [employee], now, { onlyEmpty }).length
  }
  return booked
}

/**
 * After the facility's holiday rules changed (state or Bavaria flag, the new rules already stored): books its closures
 * for its staff on the days that stopped being holidays, as creating the closure would have (leave in vacation mode),
 * so no closure is left with a hole. Only cells that are still empty and only days since each one moved in; days
 * that became holidays keep their entries.
 */
export function bookFreedClosureDays(db: Db, actor: SessionUser, facilityId: number, before: HolidayRules, now: Date): void {
  const list = loadClosures(db, facilityId)
  if (list.length === 0) return
  const after = facilityHolidayRules(db, facilityId)
  const since = new Map(db.select({ id: employees.id, since: employees.facilitySince }).from(employees)
    .where(eq(employees.facilityId, facilityId)).all().map(row => [row.id, row.since]))
  const onlyEmpty = (employeeId: number, date: IsoDate) => {
    const from = since.get(employeeId)
    return isHolidayIn(date, before) && !isHolidayIn(date, after) && (from == null || date >= from)
  }
  const staff = loadEmployees(db, facilityId)
  for (const closure of list) bookClosure(db, actor, facilityId, closure, staff, now, { onlyEmpty })
}

/**
 * Removes the employee's closure days of the facility from `from` on (someone moving away no longer has its closures);
 * earlier closure days stay as they were.
 */
export function unbookClosuresFrom(db: Db, actor: SessionUser, employeeId: number, facilityId: number, from: IsoDate, now: Date): void {
  const own = loadClosures(db, facilityId).map(closure => closure.id)
  if (own.length === 0) return
  // Closure days are home entries; a help-out is never removed with them.
  const booked = and(
    eq(entries.employeeId, employeeId), gte(entries.date, from), inArray(entries.closureId, own), isNull(entries.helpFacilityId),
  )
  const dates = [...new Set(db.select({ date: entries.date }).from(entries).where(booked).all().map(row => row.date))]
  const cells = dates.map(date => ({ employeeId, date }))
  const names = groupNames(db, facilityId)
  const before = cells.map(cell => describeCellAt(db, cell, names))
  db.delete(entries).where(booked).run()
  cells.forEach((cell, index) => logChange(db, {
    facilityId, ...cell, field: 'entry', before: before[index]!, after: describeCellAt(db, cell, names),
    actorId: actor.id, now: now.toISOString(),
  }))
}

/**
 * Changes a closure of the facility. A new label alone changes nothing in the plan. New dates or a new mode change it
 * in one transaction, touching only the closure's still-linked entries (unchanged since booking, the ones deleteClosure
 * removes, also of people who moved away since) and the newly covered days:
 * - linked entries on days the closure no longer covers are removed;
 * - with a new mode, the linked entries on days it still covers get the new code in place (in vacation mode within a
 *   joiner's leave limit), so whatever was added next to them stays; with the same mode they stay untouched;
 * - newly covered days are booked as creating the closure would (working days from facilitySince on, help-out days
 *   skipped, a joiner's limit after the days already booked), but only into empty cells: entries there stay.
 * A day changed by hand is no longer linked and stays as it is, even a cleared one. Each changed cell is logged.
 */
export function updateClosure(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: ClosureInput, now: Date = new Date(),
): ClosureDto {
  const current = loadClosures(db, facilityId).find(closure => closure.id === id)
  if (!current) throw new ServiceError(404, 'closure_not_found')
  const label = checkedLabel(input)
  const replan = input.startDate !== current.startDate || input.endDate !== current.endDate || input.mode !== current.mode

  return db.transaction((tx) => {
    // Closures decide the tablet's open days: an unlock that ran out must not come back on a day that opens again.
    deleteExpiredUnlocks(tx, now)
    const closure = tx.update(closures).set({ startDate: input.startDate, endDate: input.endDate, label, mode: input.mode })
      .where(eq(closures.id, id)).returning(closureColumns).get()!
    if (!replan) return closure
    const names = groupNames(tx, facilityId)
    const stamp = now.toISOString()
    /** Writes the cell of one linked entry and logs the change. */
    const change = (entry: { employeeId: number; date: IsoDate }, write: () => void) => {
      const cell = { employeeId: entry.employeeId, date: entry.date }
      const before = describeCellAt(tx, cell, names)
      write()
      logChange(tx, { facilityId, ...cell, field: 'entry', before, after: describeCellAt(tx, cell, names), actorId: actor.id, now: stamp })
    }
    const covered = (date: IsoDate) => date >= closure.startDate && date <= closure.endDate
    // Closure days are home entries; a help-out is never touched with them.
    const linked = loadEntries(tx, { closureId: id }).filter(entry => entry.helpFacilityId === null)
    for (const entry of linked.filter(entry => !covered(entry.date))) {
      change(entry, () => tx.delete(entries).where(eq(entries.id, entry.id)).run())
    }
    if (closure.mode !== current.mode) {
      const codeIds = { vacation: closureCodeId(tx, 'vacation'), closure_day: closureCodeId(tx, 'closure_day') }
      const kept = linked.filter(entry => covered(entry.date)).sort((a, b) => a.date.localeCompare(b.date))
      for (const [employeeId, list] of Map.groupBy(kept, entry => entry.employeeId)) {
        const employee = loadEmployee(tx, employeeId)
        const leave = new Set(closure.mode === 'vacation' && employee ? splitLeave(tx, employee, list.map(entry => entry.date)).vacation : [])
        for (const entry of list) {
          const absenceCodeId = leave.has(entry.date) ? codeIds.vacation : codeIds.closure_day
          change(entry, () => tx.update(entries).set({ absenceCodeId, updatedAt: stamp, updatedBy: actor.id }).where(eq(entries.id, entry.id)).run())
        }
      }
    }
    // Newly covered days (applyToCells logs them).
    bookClosure(tx, actor, facilityId, closure, loadEmployees(tx, facilityId), now, {
      onlyEmpty: (_employeeId, date) => date < current.startDate || date > current.endDate,
    })
    return closure
  })
}

export function deleteClosure(db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date()): void {
  const own = db.select({ id: closures.id }).from(closures).where(and(eq(closures.id, id), eq(closures.facilityId, facilityId))).get()
  if (!own) throw new ServiceError(404, 'closure_not_found')
  db.transaction((tx) => {
    deleteExpiredUnlocks(tx, now)
    const cells = loadEntries(tx, { closureId: id }).filter(entry => entry.helpFacilityId === null)
      .map(entry => ({ employeeId: entry.employeeId, date: entry.date }))
    const names = groupNames(tx, facilityId)
    const before = cells.map(cell => describeCellAt(tx, cell, names))
    // Closure days are home entries; a help-out is never removed with them.
    tx.delete(entries).where(and(eq(entries.closureId, id), isNull(entries.helpFacilityId))).run()
    cells.forEach((cell, index) => logChange(tx, {
      facilityId, ...cell, field: 'entry', before: before[index]!, after: describeCellAt(tx, cell, names),
      actorId: actor.id, now: now.toISOString(),
    }))
    tx.delete(closures).where(eq(closures.id, id)).run()
  })
}
