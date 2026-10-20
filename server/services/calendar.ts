import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { groupLeaveRanges } from '../../shared/domain/leave'
import { dateRange, isWeekend } from '../../shared/domain/dates'
import { isHolidayIn } from '../../shared/domain/holidays'
import { isEmployedInRange, isEmployedOn, isWorkday } from '../../shared/domain/targets'
import type { CodeKey, IsoDate, Minutes } from '../../shared/domain/types'
import type { CalendarEventDto, CalendarKind, SessionUser, SickYearRowDto, YearCalendarDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { calendarEvents, employees } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { autoEventsFor } from './autoEvents'
import { listGroups } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { type EmployeeRecord, loadCodes, loadEmployees, loadEntries } from './queries'

/** Calendar colour group of each absence code; codes not listed (sonstiges, VZ, Büro) are not shown. */
const KIND_OF_CODE: Partial<Record<CodeKey, CalendarKind>> = {
  sick: 'sick', vacation: 'vacation', special_leave: 'special_leave', training: 'training', school: 'training', holiday: 'closed', closure_day: 'closed',
}
/** When a day has several codes, the first kind in this list wins. */
const KIND_PRIORITY: CalendarKind[] = ['sick', 'vacation', 'special_leave', 'training', 'closed']
/** Absences the admin enters by clicking a calendar day (written to the plan). */
const ABSENCE_KEYS: CodeKey[] = ['vacation', 'special_leave', 'sick', 'training', 'school']

export interface CalendarEventInput {
  date: IsoDate
  start: Minutes | null
  end: Minutes | null
  title: string
  visibleToStaff: boolean
}

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` })

function staffOfYear(db: Db, facilityId: number, year: number) {
  const { from, to } = yearBounds(year)
  return loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, from, to))
}

/** Sick periods (Mon–Fri without holidays, bridging weekends) and the number of sick workdays per employee of the facility. */
export function getSickYear(db: Db, facilityId: number, year: number): SickYearRowDto[] {
  const sickDates = loadEntries(db, { ...yearBounds(year), codeKey: 'sick', homeFacilityId: facilityId })
  return staffOfYear(db, facilityId, year).map((employee) => {
    const ranges = groupLeaveRanges(
      sickDates.filter(entry => entry.employeeId === employee.id).map(entry => entry.date),
      date => isWorkday(employee.info, date),
    )
    return { employeeId: employee.id, name: employee.name, total: ranges.reduce((sum, range) => sum + range.days, 0), ranges }
  })
}

/**
 * The year calendar as employees see it (read-only): everyone's leave, special leave, training and school, closures
 * and holidays, but sick days only of the viewer themselves (health data), and only appointments shared with staff.
 */
export function getStaffYearCalendar(db: Db, facilityId: number, year: number, viewerEmployeeId: number | null): YearCalendarDto {
  const calendar = getYearCalendar(db, facilityId, year, { sickOnlyOf: viewerEmployeeId })
  return { ...calendar, otherEntries: {}, absenceCodes: [], events: calendar.events.filter(event => event.visibleToStaff) }
}

/** The staff year calendar of the viewer's own employee's (home) facility. */
export function getMyYearCalendar(db: Db, viewer: SessionUser, year: number): YearCalendarDto {
  const employee = viewer.employeeId === null
    ? undefined
    : db.select({ id: employees.id, facilityId: employees.facilityId }).from(employees).where(eq(employees.id, viewer.employeeId)).get()
  if (!employee) throw new ServiceError(403, 'no_employee')
  return getStaffYearCalendar(db, employee.facilityId, year, employee.id)
}

/**
 * The calendar rows sorted by home group: the facility's groups in their order, people without a group last; within a
 * group the staff order stays. Also the groups that have people in it, for the legend.
 */
function groupedRows(db: Db, facilityId: number, staff: EmployeeRecord[]) {
  const facilityGroups = listGroups(db, facilityId)
  const position = new Map(facilityGroups.map((group, index) => [group.id, index]))
  const rank = (groupId: number | null) => (groupId === null ? undefined : position.get(groupId)) ?? facilityGroups.length
  const rows = staff
    .map(employee => ({ employee, rank: rank(employee.groupId) }))
    .sort((a, b) => a.rank - b.rank) // stable: the staff order within a group
    .map(({ employee, rank }) => {
      const group = facilityGroups[rank]
      return { id: employee.id, name: employee.name, groupId: group?.id ?? null, color: group?.color ?? null }
    })
  const present = new Set(rows.map(row => row.groupId))
  const groups = facilityGroups.filter(group => present.has(group.id))
    .map(group => ({ id: group.id, name: group.name, color: group.color }))
  return { rows, groups }
}

/** The facility's year calendar. With `sickOnlyOf` set, sick days of all other employees are left out (as if not entered). */
export function getYearCalendar(
  db: Db, facilityId: number, year: number, options: { sickOnlyOf?: number | null } = {},
): YearCalendarDto {
  const staff = staffOfYear(db, facilityId, year)
  const days: Record<number, Record<IsoDate, CalendarKind>> = Object.fromEntries(staff.map(employee => [employee.id, {}]))
  const otherSets = new Map(staff.map(employee => [employee.id, new Set<IsoDate>()]))
  const hideSick = 'sickOnlyOf' in options
  for (const entry of loadEntries(db, { ...yearBounds(year), homeFacilityId: facilityId })) {
    if (hideSick && entry.codeKey === 'sick' && entry.employeeId !== options.sickOnlyOf) continue
    // Plan entries an absence would replace (shifts, VZ, Feiertag …): the calendar asks before overwriting them.
    if (!entry.codeKey || !ABSENCE_KEYS.includes(entry.codeKey)) otherSets.get(entry.employeeId)?.add(entry.date)
    const kind = entry.codeKey ? KIND_OF_CODE[entry.codeKey] : undefined
    const row = days[entry.employeeId]
    if (!kind || !row) continue
    const current = row[entry.date]
    if (!current || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(current)) row[entry.date] = kind
  }
  const { rows, groups } = groupedRows(db, facilityId, staff)
  return {
    year,
    holidays: facilityHolidayRules(db, facilityId),
    employees: rows,
    groups,
    days,
    otherEntries: Object.fromEntries([...otherSets].map(([id, set]) => [id, [...set].sort()])),
    // Mon–Fri (no holiday of the person's home facility) on which a part-timer does not work: shown like weekends,
    // skipped when entering absences.
    freeDays: Object.fromEntries(staff.map(employee => [employee.id, dateRange(`${year}-01-01`, `${year}-12-31`)
      .filter(date => !isWeekend(date) && !isHolidayIn(date, employee.info.holidays) && isEmployedOn(employee.info, date) && !isWorkday(employee.info, date))])),
    absenceCodes: loadCodes(db).filter(code => ABSENCE_KEYS.includes(code.key)),
    events: listCalendarEvents(db, facilityId, year),
    // Anonymous (no child names), so the staff calendar keeps them all.
    autoEvents: Object.fromEntries(autoEventsFor(db, facilityId, `${year}-01-01`, `${year}-12-31`)),
  }
}

const eventColumns = {
  id: calendarEvents.id, date: calendarEvents.date, start: calendarEvents.start, end: calendarEvents.end,
  title: calendarEvents.title, visibleToStaff: calendarEvents.visibleToStaff,
}

export function listCalendarEvents(db: Db, facilityId: number, year: number): CalendarEventDto[] {
  const { from, to } = yearBounds(year)
  return db.select(eventColumns).from(calendarEvents)
    .where(and(eq(calendarEvents.facilityId, facilityId), gte(calendarEvents.date, from), lte(calendarEvents.date, to)))
    .orderBy(asc(calendarEvents.date), asc(calendarEvents.start), asc(calendarEvents.id)).all()
}

/** Title required; a time is optional, an end needs a start and must lie after it. */
function normalizeEvent(input: CalendarEventInput): CalendarEventInput {
  const title = input.title.trim()
  if (!title) throw new ServiceError(400, 'title_required')
  if (input.end !== null && (input.start === null || input.end <= input.start)) throw new ServiceError(400, 'span_end_before_start')
  return { ...input, title }
}

/** Matches the facility's appointment with this id. */
const ownEvent = (facilityId: number, id: number) => and(eq(calendarEvents.id, id), eq(calendarEvents.facilityId, facilityId))

export function createCalendarEvent(db: Db, facilityId: number, input: CalendarEventInput): CalendarEventDto {
  return db.insert(calendarEvents).values({ ...normalizeEvent(input), facilityId }).returning(eventColumns).get()
}

/** Another facility's appointment gives event_not_found. */
export function updateCalendarEvent(db: Db, facilityId: number, id: number, input: CalendarEventInput): void {
  if (!db.select({ id: calendarEvents.id }).from(calendarEvents).where(ownEvent(facilityId, id)).get()) {
    throw new ServiceError(404, 'event_not_found')
  }
  db.update(calendarEvents).set(normalizeEvent(input)).where(eq(calendarEvents.id, id)).run()
}

/** Deletes the facility's appointment; other ids are ignored. */
export function deleteCalendarEvent(db: Db, facilityId: number, id: number): void {
  db.delete(calendarEvents).where(ownEvent(facilityId, id)).run()
}
