import { and, eq } from 'drizzle-orm'
import { describeCellDetailed } from '../../shared/domain/describe'
import { parseIsoDate } from '../../shared/domain/dates'
import { leaveAccount } from '../../shared/domain/leave'
import { employmentStart, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, employees, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { yearEntitlement } from './leave'
import { closureOn, loadClosures, loadEmployee, loadEntries, type EmployeeRecord } from './queries'

// How a closure becomes entries of one person (shared by closures.ts and the help-out paths in entries.ts / revert.ts).

export function closureCodeId(db: Db, key: 'vacation' | 'closure_day'): number {
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
export function splitLeave(db: Db, employee: EmployeeRecord, dates: IsoDate[]): { vacation: IsoDate[]; closureDays: IsoDate[] } {
  const vacation: IsoDate[] = []
  const closureDays: IsoDate[] = []
  const byYear = Map.groupBy(dates, date => parseIsoDate(date).year)
  for (const [year, yearDates] of byYear) {
    const entitlement = joinedDuring(employee, year)
      ? yearEntitlement(db, employee, year)
      : null
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
 * A help-out day that became empty again (the other plan cleared, deleted or discarded it) gets back the home
 * facility's closure covering it, booked as creating the closure would have: only on a working day since the person
 * belongs to the facility, as leave or (for a joiner without leave left) a closure day. Logged in the home facility.
 * Does nothing when the day is not empty or no home closure covers it.
 */
export function rebookHomeClosure(db: Db, actor: SessionUser, employeeId: number, date: IsoDate, now: string): void {
  const occupied = db.select({ id: entries.id }).from(entries)
    .where(and(eq(entries.employeeId, employeeId), eq(entries.date, date))).limit(1).get()
  if (occupied) return
  const employee = loadEmployee(db, employeeId)
  if (!employee) return
  const closure = closureOn(loadClosures(db, employee.facilityId), date)
  if (!closure || !isWorkday(employee.info, date)) return
  const since = db.select({ since: employees.facilitySince }).from(employees).where(eq(employees.id, employeeId)).get()?.since
  if (since != null && date < since) return
  const asLeave = closure.mode === 'vacation' && splitLeave(db, employee, [date]).vacation.length > 0
  db.insert(entries).values({
    employeeId, date, kind: 'code', shiftTemplateId: null, absenceCodeId: closureCodeId(db, asLeave ? 'vacation' : 'closure_day'),
    start: null, end: null, breakStart: null, breakEnd: null, countsAsStaff: true, note: null,
    helpFacilityId: null, closureId: closure.id, updatedAt: now, updatedBy: actor.id,
  }).run()
  logChange(db, {
    facilityId: employee.facilityId, date, employeeId, field: 'entry', before: '—',
    after: describeCellDetailed(loadEntries(db, { employeeId, from: date, to: date })), actorId: actor.id, now,
  })
}
