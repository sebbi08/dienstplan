import { and, eq } from 'drizzle-orm'
import { groupLeaveRanges, leaveAccount } from '../../shared/domain/leave'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { LeaveAccountDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployees, loadEntries } from './queries'

export function getLeaveAccount(db: Db, employeeId: number, year: number, today: IsoDate): LeaveAccountDto {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const vacationDates = loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const entitlement = db.select().from(leaveEntitlements)
    .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year))).get()
  return {
    employeeId, name: employee.name, year,
    account: leaveAccount(entitlement ?? null, vacationDates, year, today),
    ranges: groupLeaveRanges(vacationDates),
  }
}

export function getLeaveOverview(db: Db, year: number, today: IsoDate): LeaveAccountDto[] {
  return loadEmployees(db)
    .filter(employee => isEmployedInRange(employee.info, `${year}-01-01`, `${year}-12-31`))
    .map(employee => getLeaveAccount(db, employee.id, year, today))
}
