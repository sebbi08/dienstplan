import { and, eq } from 'drizzle-orm'
import { dateRange, daysBetween, parseIsoDate } from '../../shared/domain/dates'
import { leaveAccount } from '../../shared/domain/leave'
import { employmentStart, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureDto, ClosureMode, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, entries, leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { applyToCells, describeCellAt } from './entries'
import { closureColumns, loadClosures, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

export interface ClosureInput {
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

export function listClosures(db: Db, facilityId: number): ClosureDto[] {
  return loadClosures(db, facilityId)
}

function codeId(db: Db, key: 'vacation' | 'closure_day'): number {
  const code = db.select().from(absenceCodes).where(eq(absenceCodes.key, key)).get()
  if (!code) throw new ServiceError(500, 'code_not_found')
  return code.id
}

/** True when the employee started during that year (not on 1 January); such joiners never go below zero leave by closures. */
function joinedDuring(employee: EmployeeRecord, year: number): boolean {
  const start = employmentStart(employee.info)
  return start !== null && parseIsoDate(start).year === year && start > `${year}-01-01`
}

/**
 * Splits one employee's closure days into leave days and closure days. Normally all are leave (staff may go
 * below zero). Someone who joined during that year only gets as many leave days as they have left; the rest
 * become closure days (credited like leave, no leave used). Without a recorded entitlement nothing is limited.
 */
function splitLeave(db: Db, employee: EmployeeRecord, dates: IsoDate[]): { vacation: IsoDate[]; closureDays: IsoDate[] } {
  const vacation: IsoDate[] = []
  const closureDays: IsoDate[] = []
  const byYear = Map.groupBy(dates, date => parseIsoDate(date).year)
  for (const [year, yearDates] of byYear) {
    const entitlement = joinedDuring(employee, year)
      ? db.select().from(leaveEntitlements)
        .where(and(eq(leaveEntitlements.employeeId, employee.id), eq(leaveEntitlements.year, year))).get()
      : undefined
    if (!entitlement) {
      vacation.push(...yearDates)
      continue
    }
    const booking = new Set(yearDates)
    const otherLeave = loadEntries(db, { employeeId: employee.id, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
      .map(entry => entry.date).filter(date => !booking.has(date))
    const left = Math.max(0, Math.floor(leaveAccount(entitlement, otherLeave, year, `${year}-01-01`, date => isWorkday(employee.info, date)).available))
    vacation.push(...yearDates.slice(0, left))
    closureDays.push(...yearDates.slice(left))
  }
  return { vacation, closureDays }
}

/**
 * Books a closure of the facility for the given staff (all of that facility), only on each one's working days
 * (a closure never uses leave on a day off).
 */
function bookClosure(
  db: Db, actor: SessionUser, facilityId: number, closure: ClosureDto, staff: EmployeeRecord[], now: Date,
): void {
  const vacationCells: { employeeId: number; date: IsoDate }[] = []
  const closureCells: { employeeId: number; date: IsoDate }[] = []
  for (const employee of staff) {
    const dates = dateRange(closure.startDate, closure.endDate).filter(date => isWorkday(employee.info, date))
    const split = closure.mode === 'vacation' ? splitLeave(db, employee, dates) : { vacation: [], closureDays: dates }
    vacationCells.push(...split.vacation.map(date => ({ employeeId: employee.id, date })))
    closureCells.push(...split.closureDays.map(date => ({ employeeId: employee.id, date })))
  }
  const options = { now, closureId: closure.id }
  if (vacationCells.length) applyToCells(db, actor, facilityId, vacationCells, 'replace', { kind: 'code', codeId: codeId(db, 'vacation') }, options)
  if (closureCells.length) applyToCells(db, actor, facilityId, closureCells, 'replace', { kind: 'code', codeId: codeId(db, 'closure_day') }, options)
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
 * regardless of when they joined.
 */
export function bookClosuresFor(db: Db, actor: SessionUser, employeeId: number, now: Date = new Date()): void {
  const employee = loadEmployees(db).find(candidate => candidate.id === employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  for (const closure of loadClosures(db, employee.facilityId)) bookClosure(db, actor, employee.facilityId, closure, [employee], now)
}

export function deleteClosure(db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date()): void {
  const own = db.select({ id: closures.id }).from(closures).where(and(eq(closures.id, id), eq(closures.facilityId, facilityId))).get()
  if (!own) throw new ServiceError(404, 'closure_not_found')
  db.transaction((tx) => {
    const cells = loadEntries(tx, { closureId: id }).map(entry => ({ employeeId: entry.employeeId, date: entry.date }))
    const before = cells.map(cell => describeCellAt(tx, cell))
    tx.delete(entries).where(eq(entries.closureId, id)).run()
    cells.forEach((cell, index) => logChange(tx, {
      facilityId, ...cell, field: 'entry', before: before[index]!, after: describeCellAt(tx, cell),
      actorId: actor.id, now: now.toISOString(),
    }))
    tx.delete(closures).where(eq(closures.id, id)).run()
  })
}
