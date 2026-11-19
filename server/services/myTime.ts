import { eq } from 'drizzle-orm'
import { usesRecords } from '../../shared/domain/balance'
import { daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { isHomeOffice, recordedDay } from '../../shared/domain/stamping'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { MyTimeDto, RecordedDayDto, SessionUser, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'
import { computeBalances } from './balances'
import { loadEmployees, loadEntries } from './queries'
import { actualTimeFor, loadTimeRecords } from './timeTracking'

/** Own clocked times and balance of the logged-in employee. */
export function getMyTime(db: Db, viewer: SessionUser, year: number, month: number, now: Date = new Date()): MyTimeDto {
  if (viewer.employeeId === null) throw new ServiceError(403, 'no_employee')
  // Tracking, balance and records follow the employee's own (home) facility.
  const facilityId = db.select({ facilityId: employees.facilityId }).from(employees).where(eq(employees.id, viewer.employeeId)).get()?.facilityId
  const employee = facilityId === undefined
    ? undefined
    : loadEmployees(db, facilityId).find(candidate => candidate.id === viewer.employeeId)
  if (!employee) throw new ServiceError(403, 'no_employee')
  const { date: today } = nowInBerlin(now)
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const [balance] = computeBalances(db, employee.facilityId, [employee], monthEnd, today)
  // The employee sees „offline erfasst“, the tablet's clock difference only the Leitung and the Träger.
  const own = loadTimeRecords(db, { employeeId: employee.id }).map(record => ({ ...record, clockSkewMinutes: null }))
  const todayRecords = own.filter(record => record.date === today)
  const records = own.filter(record => record.date >= monthStart && record.date <= monthEnd)
  return {
    enabled: activeTrackingFrom(db, employee.facilityId, today) !== null,
    stampVia: employee.stampVia,
    breakMode: employee.breakMode,
    today,
    clockedInSince: todayRecords.find(record => record.end === null)?.start ?? null,
    todayRecords,
    openEarlier: [...new Set(own.filter(record => record.end === null && record.date < today).map(record => record.date))],
    balanceToday: balance!.today,
    balanceMonthEnd: balance!.monthEnd,
    records,
    recordedDays: recordedDays(db, employee.facilityId, employee.id, records, monthStart, monthEnd, today),
  }
}

/**
 * „Erfasst“ per day as on the admin time page (recordedDay with the same tracking range): days with records, and days
 * of the range with home office of the current plan (as the balance counts it).
 */
function recordedDays(
  db: Db, facilityId: number, employeeId: number, records: TimeRecordDto[], from: IsoDate, to: IsoDate, today: IsoDate,
): Record<IsoDate, RecordedDayDto> {
  const actual = actualTimeFor(db, facilityId, today)(employeeId)
  const entriesByDate = Map.groupBy(loadEntries(db, { employeeId, from, to }), entry => entry.date)
  const recordsByDate = Map.groupBy(records, record => record.date)
  const dates = new Set([...recordsByDate.keys(), ...[...entriesByDate].filter(([, day]) => day.some(isHomeOffice)).map(([date]) => date)])
  const result: Record<IsoDate, RecordedDayDto> = {}
  for (const date of [...dates].sort()) {
    const day = recordedDay(recordsByDate.get(date) ?? [], entriesByDate.get(date) ?? [], usesRecords(actual, date))
    if (day.homeOffice.length > 0 || recordsByDate.has(date)) result[date] = day
  }
  return result
}
