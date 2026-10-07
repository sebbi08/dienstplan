import { and, asc, eq, gte, isNull, lt, lte } from 'drizzle-orm'
import type { ActualTime } from '../../shared/domain/balance'
import { computeDay, usesRecords } from '../../shared/domain/balance'
import { daysInMonth, isWeekend, monthDates, toIsoDate, weekday } from '../../shared/domain/dates'
import { describeCellDetailed } from '../../shared/domain/describe'
import { holidayOn } from '../../shared/domain/holidays'
import { creditedMinutes, mayStampVia, plannedBreakMinutes } from '../../shared/domain/stamping'
import { isEmployedOn } from '../../shared/domain/targets'
import { formatTime } from '../../shared/domain/time'
import { nowInBerlin, recordedMinutes } from '../../shared/domain/timeRecords'
import type { CodeKey, IsoDate, Minutes } from '../../shared/domain/types'
import { timeWarnings } from '../../shared/domain/warnings'
import type { OpenRecordDto, SessionUser, StampAction, TimeMonthDto, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, timeDayNotes, timeRecordChanges, timeRecords, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom, getTimeTrackingFrom } from './appSettings'
import { assertEmployee } from './employees'
import { loadCodes, loadEmployees, loadEntries } from './queries'

/** Codes the admin enters per day on the time page (written to the plan). */
const ABSENCE_KEYS: CodeKey[] = ['vacation', 'special_leave', 'sick', 'training', 'school']

export interface TimeRecordFilter {
  employeeId?: number
  /** Only records of the facility's employees. */
  facilityId?: number
  from?: IsoDate
  to?: IsoDate
}

export function loadTimeRecords(db: Db, filter: TimeRecordFilter = {}): TimeRecordDto[] {
  return db.select({ record: timeRecords, editor: users.username })
    .from(timeRecords)
    .innerJoin(employees, eq(timeRecords.employeeId, employees.id))
    .leftJoin(users, eq(timeRecords.editedBy, users.id))
    .where(and(
      filter.employeeId !== undefined ? eq(timeRecords.employeeId, filter.employeeId) : undefined,
      filter.facilityId !== undefined ? eq(employees.facilityId, filter.facilityId) : undefined,
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

/** Per employee of the facility: recorded minutes for the balance, or undefined while time tracking is not active. */
export function actualTimeFor(db: Db, facilityId: number, today: IsoDate): (employeeId: number) => ActualTime | undefined {
  const from = activeTrackingFrom(db, facilityId, today)
  if (from === null) return () => undefined
  const byEmployee = new Map<number, Map<IsoDate, TimeRecordDto[]>>()
  for (const record of loadTimeRecords(db, { from, facilityId })) {
    const days = byEmployee.get(record.employeeId) ?? new Map<IsoDate, TimeRecordDto[]>()
    days.set(record.date, [...(days.get(record.date) ?? []), record])
    byEmployee.set(record.employeeId, days)
  }
  // With automatic breaks the planned break of the day is deducted from the clocked time.
  const breakModes = new Map(loadEmployees(db, facilityId).map(employee => [employee.id, employee.breakMode]))
  const plannedBreaks = new Map<string, number>()
  for (const entry of loadEntries(db, { from, to: today, facilityId })) {
    const key = `${entry.employeeId}:${entry.date}`
    plannedBreaks.set(key, (plannedBreaks.get(key) ?? 0) + plannedBreakMinutes([entry]))
  }
  return (employeeId) => {
    const mode = breakModes.get(employeeId) ?? 'stamp'
    const minutesByDate = new Map<IsoDate, number>()
    for (const [date, list] of byEmployee.get(employeeId) ?? []) {
      minutesByDate.set(date, creditedMinutes(list, mode, plannedBreaks.get(`${employeeId}:${date}`) ?? 0))
    }
    return { from, today, minutesByDate }
  }
}

/** Clocks the employee in or out now. Only today's open record can be closed; older ones are fixed by the admin. */
export function stamp(db: Db, employeeId: number, action: StampAction, source: 'self' | 'terminal', now: Date = new Date()): TimeRecordDto {
  const { date, minutes } = nowInBerlin(now)
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  if (activeTrackingFrom(db, employee.facilityId, date) === null) throw new ServiceError(400, 'time_tracking_off')
  // The tablet always works; the Leitung decides per employee whether the own phone may be used as well.
  if (!mayStampVia(employee.stampVia, source)) throw new ServiceError(403, 'stamp_tablet_only')

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

const describeSpan = (record: { start: Minutes; end: Minutes | null } | null) =>
  record === null ? '—' : `${formatTime(record.start)}–${record.end === null ? '…' : formatTime(record.end)}`

/** A record of one of the facility's employees; otherwise record_not_found. */
function findRecord(db: Db, facilityId: number, id: number) {
  const row = db.select({ record: timeRecords }).from(timeRecords)
    .innerJoin(employees, eq(timeRecords.employeeId, employees.id))
    .where(and(eq(timeRecords.id, id), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'record_not_found')
  return row.record
}

/** Admin corrections: end after start, not in the future, no overlap with other records of the day. */
function assertSpan(db: Db, employeeId: number, date: IsoDate, start: Minutes, end: Minutes, ignoreId: number | null, now: Date): void {
  if (end <= start) throw new ServiceError(400, 'span_end_before_start')
  const current = nowInBerlin(now)
  if (date > current.date || (date === current.date && end > current.minutes)) throw new ServiceError(400, 'record_in_future')
  const overlapping = db.select().from(timeRecords)
    .where(and(eq(timeRecords.employeeId, employeeId), eq(timeRecords.date, date))).all()
    .some(other => other.id !== ignoreId && start < (other.end ?? 24 * 60) && other.start < end)
  if (overlapping) throw new ServiceError(400, 'record_overlap')
}

function logRecordChange(db: Db, actor: SessionUser, record: { employeeId: number; date: IsoDate }, recordId: number | null, before: string, after: string, now: Date): void {
  db.insert(timeRecordChanges).values({
    employeeId: record.employeeId, date: record.date, recordId, before, after, actorId: actor.id, at: now.toISOString(),
  }).run()
}

export function createRecord(
  db: Db, actor: SessionUser, facilityId: number, input: { employeeId: number; date: IsoDate; start: Minutes; end: Minutes },
  now: Date = new Date(),
): void {
  assertEmployee(db, facilityId, input.employeeId)
  db.transaction((tx) => {
    assertSpan(tx, input.employeeId, input.date, input.start, input.end, null, now)
    const row = tx.insert(timeRecords).values({
      ...input, source: 'admin', editedBy: actor.id, editedAt: now.toISOString(), createdAt: now.toISOString(),
    }).returning().get()
    logRecordChange(tx, actor, input, row.id, '—', describeSpan(input), now)
  })
}

export function updateRecord(
  db: Db, actor: SessionUser, facilityId: number, id: number, span: { start: Minutes; end: Minutes }, now: Date = new Date(),
): void {
  const record = findRecord(db, facilityId, id)
  db.transaction((tx) => {
    assertSpan(tx, record.employeeId, record.date, span.start, span.end, id, now)
    tx.update(timeRecords).set({ ...span, editedBy: actor.id, editedAt: now.toISOString() }).where(eq(timeRecords.id, id)).run()
    logRecordChange(tx, actor, record, id, describeSpan(record), describeSpan(span), now)
  })
}

export function deleteRecord(db: Db, actor: SessionUser, facilityId: number, id: number, now: Date = new Date()): void {
  const record = findRecord(db, facilityId, id)
  db.transaction((tx) => {
    tx.delete(timeRecords).where(eq(timeRecords.id, id)).run()
    logRecordChange(tx, actor, record, null, describeSpan(record), '—', now)
  })
}

/** Records of earlier days still open (forgotten clock-outs) of the facility's employees. */
export function listOpenRecords(db: Db, facilityId: number, today: IsoDate): OpenRecordDto[] {
  return db.select({ record: timeRecords, name: employees.name })
    .from(timeRecords).innerJoin(employees, eq(timeRecords.employeeId, employees.id))
    .where(and(eq(employees.facilityId, facilityId), isNull(timeRecords.end), lt(timeRecords.date, today)))
    .orderBy(asc(timeRecords.date), asc(employees.sortOrder)).all()
    .map(({ record, name }) => ({ id: record.id, employeeId: record.employeeId, name, date: record.date, start: record.start }))
}

export function getTimeMonth(
  db: Db, facilityId: number, employeeId: number, year: number, month: number, today: IsoDate,
): TimeMonthDto {
  const employee = loadEmployees(db, facilityId).find(candidate => candidate.id === employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const entriesByDate = Map.groupBy(loadEntries(db, { employeeId, from: monthStart, to: monthEnd }), entry => entry.date)
  const recordsByDate = Map.groupBy(loadTimeRecords(db, { employeeId, from: monthStart, to: monthEnd }), record => record.date)
  const changes = db.select({ change: timeRecordChanges, actor: users.username })
    .from(timeRecordChanges).leftJoin(users, eq(timeRecordChanges.actorId, users.id))
    .where(and(eq(timeRecordChanges.employeeId, employeeId), gte(timeRecordChanges.date, monthStart), lte(timeRecordChanges.date, monthEnd)))
    .orderBy(asc(timeRecordChanges.id)).all()
  const actual = actualTimeFor(db, facilityId, today)(employeeId)
  const trackingFrom = getTimeTrackingFrom(db, facilityId)
  const isAbsence = (key: CodeKey | null) => key !== null && ABSENCE_KEYS.includes(key)
  const notes = new Map(db.select().from(timeDayNotes)
    .where(and(eq(timeDayNotes.employeeId, employeeId), gte(timeDayNotes.date, monthStart), lte(timeDayNotes.date, monthEnd))).all()
    .map(row => [row.date, row.note]))

  return {
    employee: { id: employee.id, name: employee.name },
    trackingFrom,
    absenceCodes: loadCodes(db).filter(code => isAbsence(code.key)),
    days: monthDates(year, month).map((date) => {
      const dayEntries = entriesByDate.get(date) ?? []
      const records = recordsByDate.get(date) ?? []
      const planned = computeDay(employee.info, date, dayEntries)
      const counted = computeDay(employee.info, date, dayEntries, actual)
      // Only the absences entered on the time page; Feiertag/Schließtag still credit the target (computeDay).
      const absence = dayEntries.some(entry => isAbsence(entry.codeKey))
      const otherEntries = dayEntries.some(entry => !isAbsence(entry.codeKey))
      const inRange = actual !== undefined && usesRecords(actual, date) && isEmployedOn(employee.info, date)
      return {
        date, weekday: weekday(date), isWeekend: isWeekend(date), holidayKey: holidayOn(date),
        plan: describeCellDetailed(dayEntries),
        plannedMinutes: planned.credit, target: planned.target,
        records, recordedMinutes: recordedMinutes(records), counted: counted.credit,
        usesRecords: usesRecords(actual, date), absence, otherEntries,
        targetCredit: dayEntries.some(entry => entry.creditMode === 'daily_target'),
        warnings: inRange ? timeWarnings(date, employeeId, dayEntries, records, employee.breakMode) : [],
        note: notes.get(date) ?? '',
        changes: changes.filter(({ change }) => change.date === date)
          .map(({ change, actor }) => ({ before: change.before, after: change.after, actor: actor ?? null, at: change.at })),
      }
    }),
  }
}

/** Sets the admin's reason note of one employee and day; an empty text removes it. */
export function setTimeDayNote(db: Db, facilityId: number, employeeId: number, date: IsoDate, note: string): void {
  assertEmployee(db, facilityId, employeeId)
  const text = note.trim()
  if (!text) {
    db.delete(timeDayNotes).where(and(eq(timeDayNotes.employeeId, employeeId), eq(timeDayNotes.date, date))).run()
    return
  }
  db.insert(timeDayNotes).values({ employeeId, date, note: text })
    .onConflictDoUpdate({ target: [timeDayNotes.employeeId, timeDayNotes.date], set: { note: text } }).run()
}
