import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import {
  eventDayCount, eventLastDay, eventVisibleTo, MAX_EVENT_DAYS, PUBLIC_AUDIENCE, seesAllEvents, type EventAudience,
  type EventVisibility,
} from '../../shared/domain/calendarEvents'
import { groupLeaveRanges } from '../../shared/domain/leave'
import { dateRange, isWeekend, todayIso } from '../../shared/domain/dates'
import { isHolidayIn } from '../../shared/domain/holidays'
import { countsAsSick, spanCovers } from '../../shared/domain/longAbsence'
import { isPrivateCode } from '../../shared/domain/maternity'
import { can } from '../../shared/domain/permissions'
import { isEmployedInRange, isEmployedOn, isWorkday } from '../../shared/domain/targets'
import type { CodeKey, IsoDate, Minutes } from '../../shared/domain/types'
import type {
  CalendarEventAudienceDto, CalendarEventDto, CalendarKind, SessionUser, SickYearRowDto, YearCalendarDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { calendarEventEmployees, calendarEventGroups, calendarEvents, employees, groups } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { autoEventsFor } from './autoEvents'
import { listGroups } from './groups'
import { facilityHolidayRules } from './holidayRules'
import { absenceSpansOf, contractWorkday, sickDatesWithLongAbsences } from './longAbsence'
import { fullParentalLeaveDates, parentalLeaveLabel } from './parentalLeave'
import { type EmployeeRecord, loadCodes, loadEmployees, loadEntries } from './queries'

type ParentalLeaveLabel = 'parental_leave' | 'absent'

/**
 * Calendar colour group of each absence code; codes not listed (sonstiges, VZ, Büro) are not shown. „Kind krank“ shows as
 * Krank, Mutterschutz and Beschäftigungsverbot as one kind (MuSchG).
 */
const KIND_OF_CODE: Partial<Record<CodeKey, CalendarKind>> = {
  sick: 'sick', child_sick: 'sick', maternity: 'maternity', employment_ban: 'maternity', vacation: 'vacation', overtime_off: 'overtime_off', special_leave: 'special_leave', training: 'training',
  school: 'training', holiday: 'closed', closure_day: 'closed',
}
/** When a day has several codes, the first kind in this list wins. */
const KIND_PRIORITY: CalendarKind[] = ['sick', 'maternity', 'absent', 'vacation', 'overtime_off', 'special_leave', 'training', 'closed']
/** Absences the admin enters by clicking a calendar day (written to the plan). */
const ABSENCE_KEYS: CodeKey[] = [
  'vacation', 'overtime_off', 'special_leave', 'sick', 'child_sick', 'maternity', 'employment_ban', 'training', 'school',
]
/** Health data the staff calendar shows only of the viewer themselves: Krank, Kind krank, Mutterschutz, Beschäftigungsverbot. */
const HEALTH_KEYS: CodeKey[] = ['sick', 'child_sick', 'maternity', 'employment_ban']

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` })

function staffOfYear(db: Db, facilityId: number, year: number) {
  const { from, to } = yearBounds(year)
  return loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, from, to))
}

/**
 * Sick periods (Mon–Fri without holidays, bridging weekends) and the number of sick workdays per employee of the
 * facility: the „Krank“ entries and the days of a long absence Langzeitkrank or Kur/Reha up to today (each working day,
 * counted exactly as a „Krank“ entry, sickDatesWithLongAbsences; a day with both counts once).
 */
export function getSickYear(db: Db, facilityId: number, year: number, today: IsoDate = todayIso()): SickYearRowDto[] {
  const { from, to } = yearBounds(year)
  const sickDates = loadEntries(db, { from, to, codeKey: 'sick', homeFacilityId: facilityId })
  return staffOfYear(db, facilityId, year).map((employee) => {
    const ranges = groupLeaveRanges(
      sickDatesWithLongAbsences(
        employee, sickDates.filter(entry => entry.employeeId === employee.id).map(entry => entry.date), from, to < today ? to : today,
      ),
      date => isWorkday(employee.info, date),
    )
    return { employeeId: employee.id, name: employee.name, total: ranges.reduce((sum, range) => sum + range.days, 0), ranges }
  })
}

/**
 * The year calendar as employees see it (read-only): everyone's leave, special leave, training and school, closures
 * and holidays, but sick days only of the viewer themselves (health data), and only the appointments meant for the
 * viewer (`audience`; by default as the employee `viewerEmployeeId` in their home group, see eventAudienceOf).
 */
export function getStaffYearCalendar(
  db: Db, facilityId: number, year: number, viewerEmployeeId: number | null, parentalLeaveLabel: ParentalLeaveLabel = 'absent',
  audience: EventAudience = staffAudience(db, viewerEmployeeId),
): YearCalendarDto {
  const calendar = getYearCalendar(db, facilityId, year, { sickOnlyOf: viewerEmployeeId, parentalLeaveLabel, eventAudience: audience })
  return { ...calendar, otherEntries: {}, absenceCodes: [] }
}

/** The staff year calendar of the viewer's own employee's (home) facility. */
export function getMyYearCalendar(db: Db, viewer: SessionUser, year: number): YearCalendarDto {
  const employee = viewer.employeeId === null
    ? undefined
    : db.select({ id: employees.id, facilityId: employees.facilityId }).from(employees).where(eq(employees.id, viewer.employeeId)).get()
  if (!employee) throw new ServiceError(403, 'no_employee')
  return getStaffYearCalendar(
    db, employee.facilityId, year, employee.id, parentalLeaveLabel(db, viewer, employee.facilityId), eventAudienceOf(db, viewer),
  )
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

/**
 * The facility's year calendar. With `sickOnlyOf` set, sick days of all other employees are left out (as if not entered).
 * `showsProtected` false (a viewer without employees.sickness): Krank, Kind krank, Mutterschutz and Beschäftigungsverbot
 * show alike as „abwesend“ and are not offered for entering. The working days of a full Elternzeit (no stored entry) show
 * as `parentalLeaveLabel` („Elternzeit“, default, or „abwesend“ as in the plan; the viewer's own – `sickOnlyOf` – always
 * „Elternzeit“) where no entry says otherwise, and are no free days. The appointments touching the year are those
 * `eventAudience` may see (by default only „Alle“).
 */
export function getYearCalendar(
  db: Db, facilityId: number, year: number,
  options: {
    sickOnlyOf?: number | null; showsProtected?: boolean; parentalLeaveLabel?: ParentalLeaveLabel
    /** The viewer the label follows (parentalLeaveLabel), instead of a fixed `parentalLeaveLabel`. */
    parentalLeaveViewer?: Pick<SessionUser, 'role' | 'permissions'>
    /** Whose appointments: eventAudienceOf the viewer (default: only those for „Alle“). */
    eventAudience?: EventAudience
  } = {},
): YearCalendarDto {
  const leaveLabel = options.parentalLeaveViewer ? parentalLeaveLabel(db, options.parentalLeaveViewer, facilityId) : options.parentalLeaveLabel
  const showsProtected = options.showsProtected ?? true
  const staff = staffOfYear(db, facilityId, year)
  const days: Record<number, Record<IsoDate, CalendarKind>> = Object.fromEntries(staff.map(employee => [employee.id, {}]))
  const otherSets = new Map(staff.map(employee => [employee.id, new Set<IsoDate>()]))
  const hideSick = 'sickOnlyOf' in options
  for (const entry of loadEntries(db, { ...yearBounds(year), homeFacilityId: facilityId })) {
    if (hideSick && entry.codeKey && HEALTH_KEYS.includes(entry.codeKey) && entry.employeeId !== options.sickOnlyOf) continue
    // Plan entries an absence would replace (shifts, VZ, Feiertag …): the calendar asks before overwriting them.
    if (!entry.codeKey || !ABSENCE_KEYS.includes(entry.codeKey)) otherSets.get(entry.employeeId)?.add(entry.date)
    const kind = entry.codeKey ? (!showsProtected && isPrivateCode(entry.codeKey) ? 'absent' : KIND_OF_CODE[entry.codeKey]) : undefined
    const row = days[entry.employeeId]
    if (!kind || !row) continue
    const current = row[entry.date]
    if (!current || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(current)) row[entry.date] = kind
  }
  const leaveDays = new Map(staff.map(employee => [employee.id, new Set(fullParentalLeaveDates(employee.info, `${year}-01-01`, `${year}-12-31`))]))
  for (const employee of staff) {
    const kind: CalendarKind = employee.id === options.sickOnlyOf ? 'parental_leave' : leaveLabel ?? 'parental_leave'
    for (const date of leaveDays.get(employee.id)!) days[employee.id]![date] ??= kind
  }
  // An entered long absence on the person's working days where no entry says otherwise: Langzeitkrank and Kur/Reha as
  // Krank for viewers of the health data and for the person themselves, everybody else (and Sonstiges) „abwesend“.
  const absenceDays = new Map(staff.map(employee => [employee.id, new Set<IsoDate>()]))
  const spans = absenceSpansOf(db, staff)
  for (const employee of staff) {
    const own = (spans.get(employee.id) ?? []).filter(span => span.source === 'entry')
    if (own.length === 0) continue
    const sees = hideSick ? employee.id === options.sickOnlyOf : showsProtected
    for (const date of dateRange(`${year}-01-01`, `${year}-12-31`)) {
      const span = own.find(item => spanCovers(item, date))
      if (!span || !isEmployedOn(employee.info, date) || !contractWorkday(employee.info, date)) continue
      absenceDays.get(employee.id)!.add(date)
      // Over Urlaub (and a closure booked before the absence) the absence wins, as „Krank“ would: no leave is used there.
      const kind: CalendarKind = sees && countsAsSick(span.reason) ? 'sick' : 'absent'
      const current = days[employee.id]![date]
      if (!current || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(current)) days[employee.id]![date] = kind
    }
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
      .filter(date => !isWeekend(date) && !isHolidayIn(date, employee.info.holidays) && isEmployedOn(employee.info, date) && !isWorkday(employee.info, date)
        && !leaveDays.get(employee.id)!.has(date) && !absenceDays.get(employee.id)!.has(date))])),
    absenceCodes: loadCodes(db).filter(code => ABSENCE_KEYS.includes(code.key) && (showsProtected || !isPrivateCode(code.key))),
    events: loadCalendarEvents(db, facilityId, `${year}-01-01`, `${year}-12-31`, options.eventAudience ?? PUBLIC_AUDIENCE),
    // Anonymous (no child names), so the staff calendar keeps them all.
    autoEvents: Object.fromEntries(autoEventsFor(db, facilityId, `${year}-01-01`, `${year}-12-31`)),
  }
}

// --- appointments („Termine“) ---------------------------------------------------------------------------------

const eventColumns = {
  id: calendarEvents.id, date: calendarEvents.date, endDate: calendarEvents.endDate, start: calendarEvents.start,
  end: calendarEvents.end, title: calendarEvents.title, visibility: calendarEvents.visibility,
}

/**
 * How the viewer sees the facility's appointments: Träger, Leitung and whoever manages the calendar (calendar.edit) every
 * one; anybody else as their employee in the employee's home group (eventVisibleTo). The tablet (also unlocked: it
 * reads the plan as the tablet, see planReader) and an account without employee see only „Alle“.
 */
export function eventAudienceOf(db: Db, viewer: Pick<SessionUser, 'role' | 'permissions' | 'employeeId'>): EventAudience {
  if (viewer.role === 'terminal') return PUBLIC_AUDIENCE
  if (seesAllEvents(viewer.role, can(viewer.permissions, 'calendar.edit'))) {
    return { seesAll: true, employeeId: viewer.employeeId, groupId: null }
  }
  return staffAudience(db, viewer.employeeId)
}

/**
 * The appointments of a printout (plan, year calendar): printouts get hung up, so only „Alle“ – for every viewer – unless
 * the viewer sees all appointments and asks for the internal ones too (`internal`, „Interne Termine mitdrucken“).
 */
export function eventAudienceForPrint(
  db: Db, viewer: Pick<SessionUser, 'role' | 'permissions' | 'employeeId'>, internal: boolean,
): EventAudience {
  const audience = eventAudienceOf(db, viewer)
  return internal && audience.seesAll ? audience : PUBLIC_AUDIENCE
}

/** The appointments the viewer gets from a plan or calendar route: the print view's when it asks with `?print=1`. */
export function eventAudienceFor(
  db: Db, viewer: Pick<SessionUser, 'role' | 'permissions' | 'employeeId'>, view: { print: boolean; internal: boolean },
): EventAudience {
  return view.print ? eventAudienceForPrint(db, viewer, view.internal) : eventAudienceOf(db, viewer)
}

/** An employee's view (null = none: only „Alle“): their own appointments and those of their home group. */
export function staffAudience(db: Db, employeeId: number | null): EventAudience {
  const employee = employeeId === null
    ? undefined
    : db.select({ groupId: employees.groupId }).from(employees).where(eq(employees.id, employeeId)).get()
  return employee ? { seesAll: false, employeeId, groupId: employee.groupId } : PUBLIC_AUDIENCE
}

/**
 * The facility's appointments touching from–to (also those that start before or end after), by first day, time and
 * id, with their chosen groups and employees. Only what `audience` may see; the lists only for an audience that sees
 * all (the others get them empty: whom else an appointment is for is none of their business).
 */
export function loadCalendarEvents(db: Db, facilityId: number, from: IsoDate, to: IsoDate, audience: EventAudience): CalendarEventDto[] {
  const rows = db.select(eventColumns).from(calendarEvents)
    .where(and(
      eq(calendarEvents.facilityId, facilityId), lte(calendarEvents.date, to),
      gte(sql`coalesce(${calendarEvents.endDate}, ${calendarEvents.date})`, from),
    ))
    .orderBy(asc(calendarEvents.date), asc(calendarEvents.start), asc(calendarEvents.id)).all()
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)
  const groupsOf = new Map<number, number[]>()
  for (const row of db.select().from(calendarEventGroups).where(inArray(calendarEventGroups.eventId, ids)).orderBy(asc(calendarEventGroups.groupId)).all()) {
    groupsOf.set(row.eventId, [...(groupsOf.get(row.eventId) ?? []), row.groupId])
  }
  const employeesOf = new Map<number, number[]>()
  for (const row of db.select().from(calendarEventEmployees).where(inArray(calendarEventEmployees.eventId, ids)).orderBy(asc(calendarEventEmployees.employeeId)).all()) {
    employeesOf.set(row.eventId, [...(employeesOf.get(row.eventId) ?? []), row.employeeId])
  }
  return rows
    .map(row => ({ ...row, groupIds: groupsOf.get(row.id) ?? [], employeeIds: employeesOf.get(row.id) ?? [] }))
    .filter(event => eventVisibleTo(event, audience))
    .map(event => (audience.seesAll ? event : { ...event, groupIds: [], employeeIds: [] }))
}

/** Every appointment of the facility touching the year, with the chosen groups and employees (for the managers). */
export function listCalendarEvents(db: Db, facilityId: number, year: number): CalendarEventDto[] {
  const { from, to } = yearBounds(year)
  return loadCalendarEvents(db, facilityId, from, to, { seesAll: true, employeeId: null, groupId: null })
}

/** Per day of from–to: the appointments on it (only days that have some). */
export function eventsByDay(events: CalendarEventDto[], from: IsoDate, to: IsoDate): Map<IsoDate, CalendarEventDto[]> {
  const byDay = new Map<IsoDate, CalendarEventDto[]>()
  for (const event of events) {
    const first = event.date > from ? event.date : from
    const last = eventLastDay(event) < to ? eventLastDay(event) : to
    for (const date of dateRange(first, last)) byDay.set(date, [...(byDay.get(date) ?? []), event])
  }
  return byDay
}

/**
 * What the appointment dialog offers: the facility's groups and its staff who have not left before today. With
 * `eventId` (an appointment of the facility being changed) also the people on its list who cannot be chosen any more
 * (`former`: left, shown as „ausgeschieden“ and taken off the list on saving).
 */
export function calendarEventAudience(
  db: Db, facilityId: number, today: IsoDate = todayIso(), eventId: number | null = null,
): CalendarEventAudienceDto {
  const choosable = loadEmployees(db, facilityId).filter(employee => employee.leftOn === null || employee.leftOn >= today)
  const ids = new Set(choosable.map(employee => employee.id))
  const linked = eventId === null
    ? []
    : db.select({ id: employees.id, name: employees.name }).from(calendarEventEmployees)
      .innerJoin(calendarEvents, eq(calendarEvents.id, calendarEventEmployees.eventId))
      .innerJoin(employees, eq(employees.id, calendarEventEmployees.employeeId))
      .where(and(eq(calendarEventEmployees.eventId, eventId), eq(calendarEvents.facilityId, facilityId)))
      .orderBy(asc(employees.name)).all()
  return {
    groups: listGroups(db, facilityId).map(group => ({ id: group.id, name: group.name })),
    employees: choosable.map(employee => ({ id: employee.id, name: employee.name, groupId: employee.groupId })),
    former: linked.filter(person => !ids.has(person.id)),
  }
}

/**
 * On a move to another facility (moveEmployeeToFacility, in its transaction): the person leaves the lists of the old
 * facility's appointments (an emptied list narrows to „Nur Leitung und Träger“, see the triggers), so a later move back
 * brings none of them back.
 */
export function dropEventLinksOnMove(tx: Db, employeeId: number, oldFacilityId: number): void {
  tx.delete(calendarEventEmployees).where(and(
    eq(calendarEventEmployees.employeeId, employeeId),
    inArray(calendarEventEmployees.eventId,
      tx.select({ id: calendarEvents.id }).from(calendarEvents).where(eq(calendarEvents.facilityId, oldFacilityId))),
  )).run()
}

export interface CalendarEventInput {
  date: IsoDate
  endDate: IsoDate | null
  start: Minutes | null
  end: Minutes | null
  title: string
  visibility: EventVisibility
  groupIds: number[]
  employeeIds: number[]
}

/**
 * Title required. A last day must not lie before the first (the same day = one day), the appointment at most
 * MAX_EVENT_DAYS days long. A time is optional; on a one-day appointment an end needs a start and must lie after it (on
 * a longer one the start is on the first day and the end on the last, so each stands alone). „Bestimmte Gruppen“ needs
 * at least one group of the facility, „Bestimmte Personen“ at least one employee of it (400 otherwise); the other
 * choices keep no list.
 */
function normalizeEvent(db: Db, facilityId: number, input: CalendarEventInput): CalendarEventInput {
  const title = input.title.trim()
  if (!title) throw new ServiceError(400, 'title_required')
  const endDate = input.endDate === null || input.endDate === input.date ? null : input.endDate
  if (endDate !== null && endDate < input.date) throw new ServiceError(400, 'event_end_before_start')
  const event = { ...input, title, endDate }
  if (eventDayCount(event) > MAX_EVENT_DAYS) throw new ServiceError(400, 'event_too_long')
  if (endDate === null && input.end !== null && (input.start === null || input.end <= input.start)) {
    throw new ServiceError(400, 'span_end_before_start')
  }
  const groupIds = input.visibility === 'groups' ? [...new Set(input.groupIds)] : []
  const employeeIds = input.visibility === 'employees' ? [...new Set(input.employeeIds)] : []
  if (input.visibility === 'groups') {
    const own = groupIds.length === 0
      ? []
      : db.select({ id: groups.id }).from(groups).where(and(eq(groups.facilityId, facilityId), inArray(groups.id, groupIds))).all()
    if (groupIds.length === 0 || own.length !== groupIds.length) throw new ServiceError(400, 'event_groups_required')
  }
  if (input.visibility === 'employees') {
    const own = employeeIds.length === 0
      ? []
      : db.select({ id: employees.id }).from(employees)
        .where(and(eq(employees.facilityId, facilityId), inArray(employees.id, employeeIds))).all()
    if (employeeIds.length === 0 || own.length !== employeeIds.length) throw new ServiceError(400, 'event_employees_required')
  }
  return { ...event, groupIds, employeeIds }
}

/**
 * A page still open from before „Wer sieht den Termin?“ sends the old yes/no (`visibleToStaff`) and no choice: 400
 * event_page_outdated („bitte die Seite neu laden“) instead of a bare validation error. Anything else passes on unchanged.
 */
export function assertCurrentEventClient(body: unknown): unknown {
  if (body !== null && typeof body === 'object' && 'visibleToStaff' in body && !('visibility' in body)) {
    throw new ServiceError(400, 'event_page_outdated')
  }
  return body
}

/** Matches the facility's appointment with this id. */
const ownEvent = (facilityId: number, id: number) => and(eq(calendarEvents.id, id), eq(calendarEvents.facilityId, facilityId))

/** Writes the appointment's lists (after the old rows went: see the triggers of the migration calendar_event_audience). */
function writeAudience(tx: Db, id: number, event: CalendarEventInput): void {
  if (event.groupIds.length) tx.insert(calendarEventGroups).values(event.groupIds.map(groupId => ({ eventId: id, groupId }))).run()
  if (event.employeeIds.length) {
    tx.insert(calendarEventEmployees).values(event.employeeIds.map(employeeId => ({ eventId: id, employeeId }))).run()
  }
}

/** The columns of the appointment's own row. */
function eventRow(event: CalendarEventInput) {
  const { date, endDate, start, end, title, visibility } = event
  return { date, endDate, start, end, title, visibility }
}

export function createCalendarEvent(db: Db, facilityId: number, input: CalendarEventInput): CalendarEventDto {
  const event = normalizeEvent(db, facilityId, input)
  return db.transaction((tx) => {
    const row = tx.insert(calendarEvents).values({ ...eventRow(event), facilityId }).returning(eventColumns).get()
    writeAudience(tx, row.id, event)
    return { ...row, groupIds: event.groupIds, employeeIds: event.employeeIds }
  })
}

/** Another facility's appointment gives event_not_found. */
export function updateCalendarEvent(db: Db, facilityId: number, id: number, input: CalendarEventInput): void {
  if (!db.select({ id: calendarEvents.id }).from(calendarEvents).where(ownEvent(facilityId, id)).get()) {
    throw new ServiceError(404, 'event_not_found')
  }
  const event = normalizeEvent(db, facilityId, input)
  db.transaction((tx) => {
    // The lists first: emptying one turns the appointment into „Nur Leitung und Träger“, the update then sets the choice.
    tx.delete(calendarEventGroups).where(eq(calendarEventGroups.eventId, id)).run()
    tx.delete(calendarEventEmployees).where(eq(calendarEventEmployees.eventId, id)).run()
    tx.update(calendarEvents).set(eventRow(event)).where(eq(calendarEvents.id, id)).run()
    writeAudience(tx, id, event)
  })
}

/** Deletes the facility's appointment (its lists go along); other ids are ignored. */
export function deleteCalendarEvent(db: Db, facilityId: number, id: number): void {
  db.delete(calendarEvents).where(ownEvent(facilityId, id)).run()
}
