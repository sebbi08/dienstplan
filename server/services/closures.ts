import { and, eq, gte, inArray, isNull } from 'drizzle-orm'
import { dateRange, daysBetween } from '../../shared/domain/dates'
import { isHolidayIn, type HolidayRules } from '../../shared/domain/holidays'
import { isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureDto, ClosureMode, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { closures, employees, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { closureCodeId, splitLeave } from './closureBooking'
import { applyToCells, cellOwner, describeCellAt } from './entries'
import { groupNames } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { closureColumns, loadClosures, loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

export interface ClosureInput {
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

export function listClosures(db: Db, facilityId: number): ClosureDto[] {
  return loadClosures(db, facilityId)
}

interface BookingScope {
  /** Only days from then on. */
  from?: IsoDate
  /** Only the days this accepts, and only cells that are still empty (nothing is overwritten). */
  onlyEmpty?: (employeeId: number, date: IsoDate) => boolean
}

/**
 * Books a closure of the facility for the given staff (all of that facility), only on each one's working days
 * (a closure never uses leave on a day off) and, with `from`, only on days from then on. Days on which someone helps
 * out in another facility are skipped (and booked when that help-out day becomes empty again, see rebookHomeClosure).
 */
function bookClosure(
  db: Db, actor: SessionUser, facilityId: number, closure: ClosureDto, staff: EmployeeRecord[], now: Date,
  { from, onlyEmpty }: BookingScope = {},
): void {
  const vacationCells: { employeeId: number; date: IsoDate }[] = []
  const closureCells: { employeeId: number; date: IsoDate }[] = []
  for (const employee of staff) {
    const free = (date: IsoDate) => onlyEmpty
      ? onlyEmpty(employee.id, date) && cellOwner(db, employee.id, date) === null
      : typeof cellOwner(db, employee.id, date) !== 'number'
    const dates = dateRange(closure.startDate, closure.endDate)
      .filter(date => isWorkday(employee.info, date) && (from === undefined || date >= from) && free(date))
    const split = closure.mode === 'vacation' ? splitLeave(db, employee, dates) : { vacation: [], closureDays: dates }
    vacationCells.push(...split.vacation.map(date => ({ employeeId: employee.id, date })))
    closureCells.push(...split.closureDays.map(date => ({ employeeId: employee.id, date })))
  }
  const options = { now, closureId: closure.id }
  if (vacationCells.length) applyToCells(db, actor, facilityId, vacationCells, 'replace', { kind: 'code', codeId: closureCodeId(db, 'vacation') }, options)
  if (closureCells.length) applyToCells(db, actor, facilityId, closureCells, 'replace', { kind: 'code', codeId: closureCodeId(db, 'closure_day') }, options)
}

/** Creates a closure of the facility and books it for the facility's staff. */
export function createClosure(
  db: Db, actor: SessionUser, facilityId: number, input: ClosureInput, now: Date = new Date(),
): ClosureDto {
  const label = input.label.trim()
  if (!label) throw new ServiceError(400, 'label_required')
  const length = daysBetween(input.startDate, input.endDate)
  if (length < 0 || length > 366) throw new ServiceError(400, 'invalid_range')

  return db.transaction((tx) => {
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

export function deleteClosure(db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date()): void {
  const own = db.select({ id: closures.id }).from(closures).where(and(eq(closures.id, id), eq(closures.facilityId, facilityId))).get()
  if (!own) throw new ServiceError(404, 'closure_not_found')
  db.transaction((tx) => {
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
