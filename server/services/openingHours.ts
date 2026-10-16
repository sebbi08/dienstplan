import { and, asc, eq, isNull } from 'drizzle-orm'
import { hoursOn, type DayHours, type OpeningHours } from '../../shared/domain/openingHours'
import type { IsoDate } from '../../shared/domain/types'
import type { DayHoursContext } from '../../shared/domain/warnings'
import type { OpeningHoursDto, PlanDayDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, groups, openingHours } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertGroup } from './groups'

const WEEKDAYS = 5
/** Minutes of a day run from 0 to 1439. */
const DAY_END = 1440

/**
 * The hours of one scope (the facility, or one of its groups) from its rows. Null = no hours: no rows and the default
 * minimum counts; entered minimum counts are kept (and returned) even while no weekday is entered.
 */
function toHours(rows: { weekday: number; open: number | null; close: number | null; closed: boolean }[],
  minAtOpening: number, minAtClosing: number): OpeningHours | null {
  if (rows.length === 0 && minAtOpening === 1 && minAtClosing === 1) return null
  const days: DayHours[] = Array.from({ length: WEEKDAYS }, () => ({ open: null, close: null, closed: false }))
  for (const row of rows) days[row.weekday] = { open: row.open, close: row.close, closed: row.closed }
  return { days, minAtOpening, minAtClosing }
}

interface Loaded {
  facility: OpeningHours | null
  groups: { groupId: number; groupName: string; hours: OpeningHours | null }[]
}

function load(db: Db, facilityId: number): Loaded {
  const rows = db.select().from(openingHours).where(eq(openingHours.facilityId, facilityId)).all()
  const facility = db.select({ minAtOpening: facilities.minAtOpening, minAtClosing: facilities.minAtClosing })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  return {
    facility: facility ? toHours(rows.filter(row => row.groupId === null), facility.minAtOpening, facility.minAtClosing) : null,
    groups: db.select().from(groups).where(eq(groups.facilityId, facilityId)).orderBy(asc(groups.sortOrder), asc(groups.id)).all()
      .map(group => ({
        groupId: group.id,
        groupName: group.name,
        hours: toHours(rows.filter(row => row.groupId === group.id), group.minAtOpening, group.minAtClosing),
      })),
  }
}

/** The facility's opening hours and the own hours of each of its groups. */
export function getOpeningHours(db: Db, facilityId: number): OpeningHoursDto {
  return load(db, facilityId)
}

/** Whether any weekday is entered (times or closed): only then the hours exist for the warnings. */
function hasEnteredDay(hours: OpeningHours | null): hours is OpeningHours {
  return hours !== null && hours.days.some(isSet)
}

/** The hours the plan's warnings check: the facility's, and only those groups that have a weekday of their own entered. */
export function loadHoursContext(db: Db, facilityId: number): DayHoursContext {
  const { facility, groups: all } = load(db, facilityId)
  return {
    facility: hasEnteredDay(facility) ? facility : null,
    groups: all.flatMap(group => hasEnteredDay(group.hours)
      ? [{ groupId: group.groupId, groupName: group.groupName, hours: group.hours }]
      : []),
  }
}

/** A day with times or marked closed; the others are not entered. */
function isSet(day: DayHours | null): day is DayHours {
  return day !== null && (day.closed || (day.open !== null && day.close !== null))
}

/** The hours of a date for the plan header: null = not entered (also on a weekend). */
function dayOf(hours: OpeningHours | null, date: IsoDate): DayHours | null {
  const day = hoursOn(hours, date)
  return isSet(day) ? day : null
}

/** Adds the opening hours of each day to the plan's day rows; none on a public holiday or closure day (closed anyway). */
export function withOpeningHours<T extends { date: IsoDate; holidayKey: string | null; closureLabel: string | null }>(
  days: T[], context: DayHoursContext,
): (T & Pick<PlanDayDto, 'opening' | 'groupOpening'>)[] {
  return days.map((day) => {
    if (day.holidayKey || day.closureLabel) return { ...day, opening: null, groupOpening: {} }
    const groupOpening: Record<number, DayHours> = {}
    for (const group of context.groups) {
      const own = dayOf(group.hours, day.date)
      if (own !== null) groupOpening[group.groupId] = own
    }
    return { ...day, opening: dayOf(context.facility, day.date), groupOpening }
  })
}

/**
 * Checks one scope's input and returns the rows to store (none when no weekday is entered). The minimum counts are
 * 1–20 (opening_min_invalid); a closed day keeps no times; a day with one time only is opening_hours_incomplete, times
 * that are no minutes of the day invalid_time, a wrong number of days invalid_input, and a close time not after the
 * open time opening_hours_invalid.
 */
function checked(input: OpeningHours): Omit<typeof openingHours.$inferInsert, 'facilityId' | 'groupId'>[] {
  const validMin = (value: number) => Number.isInteger(value) && value >= 1 && value <= 20
  if (!validMin(input.minAtOpening) || !validMin(input.minAtClosing)) throw new ServiceError(400, 'opening_min_invalid')
  if (!Array.isArray(input.days) || input.days.length !== WEEKDAYS) throw new ServiceError(400, 'invalid_input')
  const rows: Omit<typeof openingHours.$inferInsert, 'facilityId' | 'groupId'>[] = []
  input.days.forEach((day, weekday) => {
    if (day.closed) {
      rows.push({ weekday, open: null, close: null, closed: true })
      return
    }
    if (day.open === null && day.close === null) return
    if (day.open === null || day.close === null) throw new ServiceError(400, 'opening_hours_incomplete')
    const minute = (value: number) => Number.isInteger(value) && value >= 0 && value < DAY_END
    if (!minute(day.open) || !minute(day.close)) throw new ServiceError(400, 'invalid_time')
    if (day.close <= day.open) throw new ServiceError(400, 'opening_hours_invalid')
    rows.push({ weekday, open: day.open, close: day.close, closed: false })
  })
  return rows
}

function save(db: Db, facilityId: number, groupId: number | null, input: OpeningHours | null): void {
  const rows = input === null ? [] : checked(input)
  const scope = and(eq(openingHours.facilityId, facilityId), groupId === null ? isNull(openingHours.groupId) : eq(openingHours.groupId, groupId))
  // An explicit null removes the hours and resets the counts; given hours keep their counts even with no weekday entered.
  const counts = { minAtOpening: input?.minAtOpening ?? 1, minAtClosing: input?.minAtClosing ?? 1 }
  db.transaction((tx) => {
    tx.delete(openingHours).where(scope).run()
    if (rows.length > 0) tx.insert(openingHours).values(rows.map(row => ({ ...row, facilityId, groupId }))).run()
    if (groupId === null) tx.update(facilities).set(counts).where(eq(facilities.id, facilityId)).run()
    else tx.update(groups).set(counts).where(eq(groups.id, groupId)).run()
  })
}

/**
 * Sets the facility's opening hours; null removes them and resets the minimum counts, given counts are kept even with
 * no weekday entered. 400 opening_hours_invalid for a close time not after the open time, opening_hours_incomplete for
 * a day with one time only, opening_min_invalid for a minimum outside 1–20.
 */
export function setFacilityOpeningHours(db: Db, facilityId: number, input: OpeningHours | null): void {
  save(db, facilityId, null, input)
}

/** Sets a group's own opening hours (null removes them); 404 group_not_found for a group of another facility. */
export function setGroupOpeningHours(db: Db, facilityId: number, groupId: number, input: OpeningHours | null): void {
  assertGroup(db, facilityId, groupId)
  save(db, facilityId, groupId, input)
}
