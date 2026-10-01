import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import type { ActualTime } from '../../shared/domain/balance'
import { nowInBerlin, recordedMinutes } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { StampAction, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, timeRecords, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'

export interface TimeRecordFilter {
  employeeId?: number
  from?: IsoDate
  to?: IsoDate
}

export function loadTimeRecords(db: Db, filter: TimeRecordFilter = {}): TimeRecordDto[] {
  return db.select({ record: timeRecords, editor: users.username })
    .from(timeRecords)
    .leftJoin(users, eq(timeRecords.editedBy, users.id))
    .where(and(
      filter.employeeId !== undefined ? eq(timeRecords.employeeId, filter.employeeId) : undefined,
      filter.from ? gte(timeRecords.date, filter.from) : undefined,
      filter.to ? lte(timeRecords.date, filter.to) : undefined,
    ))
    .orderBy(asc(timeRecords.date), asc(timeRecords.start), asc(timeRecords.id))
    .all()
    .map(({ record, editor }) => ({
      id: record.id, employeeId: record.employeeId, date: record.date, start: record.start, end: record.end,
      source: record.source, edited: record.source === 'admin' || record.editedAt !== null,
      editedBy: editor ?? null, editedAt: record.editedAt,
    }))
}

/** Per employee: recorded minutes for the balance, or undefined while time tracking is not active. */
export function actualTimeFor(db: Db, today: IsoDate): (employeeId: number) => ActualTime | undefined {
  const from = activeTrackingFrom(db, today)
  if (from === null) return () => undefined
  const byEmployee = new Map<number, Map<IsoDate, TimeRecordDto[]>>()
  for (const record of loadTimeRecords(db, { from })) {
    const days = byEmployee.get(record.employeeId) ?? new Map<IsoDate, TimeRecordDto[]>()
    days.set(record.date, [...(days.get(record.date) ?? []), record])
    byEmployee.set(record.employeeId, days)
  }
  return (employeeId) => {
    const minutesByDate = new Map<IsoDate, number>()
    for (const [date, list] of byEmployee.get(employeeId) ?? []) minutesByDate.set(date, recordedMinutes(list))
    return { from, today, minutesByDate }
  }
}

/** Clocks the employee in or out now. Only today's open record can be closed; older ones are fixed by the admin. */
export function stamp(db: Db, employeeId: number, action: StampAction, source: 'self' | 'terminal', now: Date = new Date()): TimeRecordDto {
  const { date, minutes } = nowInBerlin(now)
  if (activeTrackingFrom(db, date) === null) throw new ServiceError(400, 'time_tracking_off')
  if (!db.select().from(employees).where(eq(employees.id, employeeId)).get()) throw new ServiceError(404, 'employee_not_found')

  return db.transaction((tx) => {
    const open = tx.select().from(timeRecords)
      .where(and(eq(timeRecords.employeeId, employeeId), eq(timeRecords.date, date), isNull(timeRecords.end))).get()
    let id: number
    if (action === 'in') {
      if (open) throw new ServiceError(409, 'already_clocked_in')
      id = tx.insert(timeRecords).values({
        employeeId, date, start: minutes, end: null, source, createdAt: now.toISOString(),
      }).returning().get().id
    }
    else {
      if (!open) throw new ServiceError(409, 'not_clocked_in')
      tx.update(timeRecords).set({ end: Math.max(minutes, open.start) }).where(eq(timeRecords.id, open.id)).run()
      id = open.id
    }
    return loadTimeRecords(tx, { employeeId, from: date, to: date }).find(record => record.id === id)!
  })
}
