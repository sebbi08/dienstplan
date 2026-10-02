import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { groupLeaveRanges } from '../../shared/domain/leave'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { CodeKey, IsoDate, Minutes } from '../../shared/domain/types'
import type { CalendarEventDto, CalendarKind, SickYearRowDto, YearCalendarDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { calendarEvents } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployees, loadEntries } from './queries'

/** Calendar colour group of each absence code; codes not listed (sonstiges, VZ, Büro) are not shown. */
const KIND_OF_CODE: Partial<Record<CodeKey, CalendarKind>> = {
  sick: 'sick', vacation: 'vacation', training: 'training', school: 'training', holiday: 'closed', closure_day: 'closed',
}
/** When a day has several codes, the first kind in this list wins. */
const KIND_PRIORITY: CalendarKind[] = ['sick', 'vacation', 'training', 'closed']

export interface CalendarEventInput {
  date: IsoDate
  start: Minutes | null
  end: Minutes | null
  title: string
}

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` })

function staffOfYear(db: Db, year: number) {
  const { from, to } = yearBounds(year)
  return loadEmployees(db).filter(employee => isEmployedInRange(employee.info, from, to))
}

/** Sick periods (Mon–Fri without holidays, bridging weekends) and the number of sick workdays per employee. */
export function getSickYear(db: Db, year: number): SickYearRowDto[] {
  const sickDates = loadEntries(db, { ...yearBounds(year), codeKey: 'sick' })
  return staffOfYear(db, year).map((employee) => {
    const ranges = groupLeaveRanges(sickDates.filter(entry => entry.employeeId === employee.id).map(entry => entry.date))
    return { employeeId: employee.id, name: employee.name, total: ranges.reduce((sum, range) => sum + range.days, 0), ranges }
  })
}

export function getYearCalendar(db: Db, year: number): YearCalendarDto {
  const staff = staffOfYear(db, year)
  const days: Record<number, Record<IsoDate, CalendarKind>> = Object.fromEntries(staff.map(employee => [employee.id, {}]))
  for (const entry of loadEntries(db, yearBounds(year))) {
    const kind = entry.codeKey ? KIND_OF_CODE[entry.codeKey] : undefined
    const row = days[entry.employeeId]
    if (!kind || !row) continue
    const current = row[entry.date]
    if (!current || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(current)) row[entry.date] = kind
  }
  return {
    year,
    employees: staff.map(employee => ({ id: employee.id, name: employee.name })),
    days,
    events: listCalendarEvents(db, year),
  }
}

export function listCalendarEvents(db: Db, year: number): CalendarEventDto[] {
  const { from, to } = yearBounds(year)
  return db.select().from(calendarEvents)
    .where(and(gte(calendarEvents.date, from), lte(calendarEvents.date, to)))
    .orderBy(asc(calendarEvents.date), asc(calendarEvents.start), asc(calendarEvents.id)).all()
}

/** Title required; a time is optional, an end needs a start and must lie after it. */
function normalizeEvent(input: CalendarEventInput): CalendarEventInput {
  const title = input.title.trim()
  if (!title) throw new ServiceError(400, 'title_required')
  if (input.end !== null && (input.start === null || input.end <= input.start)) throw new ServiceError(400, 'span_end_before_start')
  return { ...input, title }
}

export function createCalendarEvent(db: Db, input: CalendarEventInput): CalendarEventDto {
  return db.insert(calendarEvents).values(normalizeEvent(input)).returning().get()
}

export function updateCalendarEvent(db: Db, id: number, input: CalendarEventInput): void {
  if (!db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get()) throw new ServiceError(404, 'event_not_found')
  db.update(calendarEvents).set(normalizeEvent(input)).where(eq(calendarEvents.id, id)).run()
}

export function deleteCalendarEvent(db: Db, id: number): void {
  db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run()
}
