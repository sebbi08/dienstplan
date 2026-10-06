import { daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { MyTimeDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'
import { computeBalances } from './balances'
import { loadEmployees } from './queries'
import { loadTimeRecords } from './timeTracking'

/** Own clocked times and balance of the logged-in employee. */
export function getMyTime(db: Db, viewer: SessionUser, year: number, month: number, now: Date = new Date()): MyTimeDto {
  if (viewer.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = loadEmployees(db).find(candidate => candidate.id === viewer.employeeId)
  if (!employee) throw new ServiceError(403, 'no_employee')
  const { date: today } = nowInBerlin(now)
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const [balance] = computeBalances(db, [employee], monthEnd, today)
  const own = loadTimeRecords(db, { employeeId: employee.id })
  const todayRecords = own.filter(record => record.date === today)
  return {
    enabled: activeTrackingFrom(db, today) !== null,
    stampVia: employee.stampVia,
    breakMode: employee.breakMode,
    today,
    clockedInSince: todayRecords.find(record => record.end === null)?.start ?? null,
    todayRecords,
    openEarlier: [...new Set(own.filter(record => record.end === null && record.date < today).map(record => record.date))],
    balanceToday: balance!.today,
    balanceMonthEnd: balance!.monthEnd,
    records: own.filter(record => record.date >= monthStart && record.date <= monthEnd),
  }
}
