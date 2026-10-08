import { groupLeaveRanges, leaveAccount, type LeaveDayRule, type LeaveEntitlement } from '../../shared/domain/leave'
import { isEmployedInRange, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { LeaveAccountDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { ServiceError } from '../lib/errors'
import { entitlementFor, firstEntitlementYear } from './entitlements'
import { loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

export interface YearEntitlement extends LeaveEntitlement {
  /** The year the entitlement (days) was recorded for; earlier than the year when it was carried into it. */
  fromYear: number
  /** True when the carry-over is what was left of the year before (every year after the first recorded one). */
  carriedAutomatically: boolean
}

/** Only the employee's own working days count as leave days. */
function leaveDayRule(employee: EmployeeRecord): LeaveDayRule {
  return date => isWorkday(employee.info, date)
}

/**
 * Entitlement and carry-over of an employee in a year. The days are the last ones recorded up to that year. The first
 * recorded year keeps the carry-over entered for it; every later year carries over what was left of the year before,
 * a minus too. Null before the first recorded year.
 */
export function yearEntitlement(db: Db, employee: EmployeeRecord, year: number): YearEntitlement | null {
  const first = firstEntitlementYear(db, employee.id)
  if (first === null || year < first) return null
  const isLeaveDay = leaveDayRule(employee)
  const vacationDates = loadEntries(db, { employeeId: employee.id, from: `${first}-01-01`, to: `${year - 1}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  let carriedOverDays = entitlementFor(db, employee.id, first)!.carriedOverDays
  for (let current = first; current < year; current++) {
    const days = entitlementFor(db, employee.id, current)!.days
    // "available" does not depend on the day it is looked at, so any date will do.
    carriedOverDays = leaveAccount({ days, carriedOverDays }, vacationDates, current, `${current}-01-01`, isLeaveDay).available
  }
  const recorded = entitlementFor(db, employee.id, year)!
  return { days: recorded.days, carriedOverDays, fromYear: recorded.fromYear, carriedAutomatically: year > first }
}

/** The leave account of one employee (whatever facility they belong to; callers check access). */
export function getLeaveAccount(db: Db, employeeId: number, year: number, today: IsoDate): LeaveAccountDto {
  const employee = loadEmployee(db, employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const isLeaveDay = leaveDayRule(employee)
  const vacationDates = loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const entitlement = yearEntitlement(db, employee, year)
  return {
    employeeId, name: employee.name, year,
    account: leaveAccount(entitlement, vacationDates, year, today, isLeaveDay),
    inheritedFrom: entitlement && entitlement.fromYear !== year ? entitlement.fromYear : null,
    ranges: groupLeaveRanges(vacationDates, isLeaveDay),
  }
}

/** Leave accounts of the facility's staff employed in the year. */
export function getLeaveOverview(db: Db, facilityId: number, year: number, today: IsoDate): LeaveAccountDto[] {
  return loadEmployees(db, facilityId)
    .filter(employee => isEmployedInRange(employee.info, `${year}-01-01`, `${year}-12-31`))
    .map(employee => getLeaveAccount(db, employee.id, year, today))
}
