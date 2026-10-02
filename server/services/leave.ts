import { and, eq } from 'drizzle-orm'
import { groupLeaveRanges, leaveAccount } from '../../shared/domain/leave'
import { isEmployedInRange, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { LeaveAccountDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployees, loadEntries } from './queries'

export function getLeaveAccount(db: Db, employeeId: number, year: number, today: IsoDate): LeaveAccountDto {
  const employee = loadEmployees(db).find(candidate => candidate.id === employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  // Only the employee's own working days count as leave days.
  const isLeaveDay = (date: IsoDate) => isWorkday(employee.info, date)
  const vacationDates = loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const entitlement = db.select().from(leaveEntitlements)
    .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year))).get()
  return {
    employeeId, name: employee.name, year,
    account: leaveAccount(entitlement ?? null, vacationDates, year, today, isLeaveDay),
    ranges: groupLeaveRanges(vacationDates, isLeaveDay),
  }
}

export function getLeaveOverview(db: Db, year: number, today: IsoDate): LeaveAccountDto[] {
  return loadEmployees(db)
    .filter(employee => isEmployedInRange(employee.info, `${year}-01-01`, `${year}-12-31`))
    .map(employee => getLeaveAccount(db, employee.id, year, today))
}
