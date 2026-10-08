import { groupLeaveRanges, leaveAccount } from '../../shared/domain/leave'
import { isEmployedInRange, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { LeaveAccountDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { ServiceError } from '../lib/errors'
import { entitlementFor } from './entitlements'
import { loadEmployee, loadEmployees, loadEntries } from './queries'

/** The leave account of one employee (whatever facility they belong to; callers check access). */
export function getLeaveAccount(db: Db, employeeId: number, year: number, today: IsoDate): LeaveAccountDto {
  const employee = loadEmployee(db, employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  // Only the employee's own working days count as leave days.
  const isLeaveDay = (date: IsoDate) => isWorkday(employee.info, date)
  const vacationDates = loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const entitlement = entitlementFor(db, employeeId, year)
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
