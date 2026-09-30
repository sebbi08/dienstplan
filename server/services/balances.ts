import { balanceUntil } from '../../shared/domain/balance'
import { daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { isEmployedInRange, weeklyMinutesOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { BalanceDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { balanceAdjustments } from '../db/schema'
import { groupByEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

export function computeBalances(db: Db, staff: EmployeeRecord[], monthEnd: IsoDate, today: IsoDate): BalanceDto[] {
  const byEmployee = groupByEmployee(loadEntries(db))
  const adjustments = db.select().from(balanceAdjustments).all()
  return staff.map((employee) => {
    const own = byEmployee.get(employee.id) ?? []
    const ownAdjustments = adjustments.filter(a => a.employeeId === employee.id)
    return {
      employeeId: employee.id,
      name: employee.name,
      weeklyMinutes: weeklyMinutesOn(employee.info, today) ?? weeklyMinutesOn(employee.info, monthEnd),
      today: balanceUntil(employee.info, own, ownAdjustments, today),
      monthEnd: balanceUntil(employee.info, own, ownAdjustments, monthEnd),
    }
  })
}

export function getBalanceOverview(db: Db, year: number, month: number, today: IsoDate): BalanceDto[] {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  return computeBalances(db, staff, monthEnd, today)
}
