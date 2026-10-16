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
const DAY_END = 1440

/** The hours of one scope (the facility, or one of its groups) from its rows; null = no rows, no hours. */
function toHours(rows: { weekday: number; open: number | null; close: number | null; closed: boolean }[],
  minAtOpening: number, minAtClosing: number): OpeningHours | null {
  if (rows.length === 0) return null
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

/** The hours the plan's warnings check: the facility's, and only those groups that have their own. */
export function loadHoursContext(db: Db, facilityId: number): DayHoursContext {
  const { facility, groups: all } = load(db, facilityId)
  return {
    facility,
    groups: all.flatMap(group => group.hours === null ? [] : [{ groupId: group.groupId, groupName: group.groupName, hours: group.hours }]),
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

/** Adds the opening hours of each day to the plan's day rows. */
export function withOpeningHours<T extends { date: IsoDate }>(
  days: T[], context: DayHoursContext,
): (T & Pick<PlanDayDto, 'opening' | 'groupOpening'>)[] {
  return days.map((day) => {
    const groupOpening: Record<number, DayHours> = {}
    for (const group of context.groups) {
      const own = dayOf(group.hours, day.date)
      if (own !== null) groupOpening[group.groupId] = own
    }
    return { ...day, opening: dayOf(context.facility, day.date), groupOpening }
  })
}

/**
 * Checks one scope's input and returns the rows to store, or null when no weekday is entered (= no hours). The minimum
 * counts are 1–20; a closed day keeps no times; close must lie after open.
 */
function checked(input: OpeningHours): Omit<typeof openingHours.$inferInsert, 'facilityId' | 'groupId'>[] | null {
  const validMin = (value: number) => Number.isInteger(value) && value >= 1 && value <= 20
  if (!validMin(input.minAtOpening) || !validMin(input.minAtClosing)) throw new ServiceError(400, 'opening_min_invalid')
  if (!Array.isArray(input.days) || input.days.length !== WEEKDAYS) throw new ServiceError(400, 'opening_hours_invalid')
  const rows: Omit<typeof openingHours.$inferInsert, 'facilityId' | 'groupId'>[] = []
  input.days.forEach((day, weekday) => {
    if (day.closed) {
      rows.push({ weekday, open: null, close: null, closed: true })
      return
    }
    if (day.open === null && day.close === null) return
    const valid = day.open !== null && day.close !== null && Number.isInteger(day.open) && Number.isInteger(day.close)
      && day.open >= 0 && day.close <= DAY_END && day.close > day.open
    if (!valid) throw new ServiceError(400, 'opening_hours_invalid')
    rows.push({ weekday, open: day.open, close: day.close, closed: false })
  })
  return rows.length === 0 ? null : rows
}

function save(db: Db, facilityId: number, groupId: number | null, input: OpeningHours | null): void {
  const rows = input === null ? null : checked(input)
  const scope = and(eq(openingHours.facilityId, facilityId), groupId === null ? isNull(openingHours.groupId) : eq(openingHours.groupId, groupId))
  const counts = { minAtOpening: rows === null ? 1 : input!.minAtOpening, minAtClosing: rows === null ? 1 : input!.minAtClosing }
  db.transaction((tx) => {
    tx.delete(openingHours).where(scope).run()
    if (rows !== null) tx.insert(openingHours).values(rows.map(row => ({ ...row, facilityId, groupId }))).run()
    if (groupId === null) tx.update(facilities).set(counts).where(eq(facilities.id, facilityId)).run()
    else tx.update(groups).set(counts).where(eq(groups.id, groupId)).run()
  })
}

/**
 * Sets the facility's opening hours (null, or a week without any entered day, removes them and resets the minimum
 * counts). 400 opening_hours_invalid for a close time not after the open time, 400 opening_min_invalid for a minimum
 * outside 1–20.
 */
export function setFacilityOpeningHours(db: Db, facilityId: number, input: OpeningHours | null): void {
  save(db, facilityId, null, input)
}

/** Sets a group's own opening hours (null removes them); 404 group_not_found for a group of another facility. */
export function setGroupOpeningHours(db: Db, facilityId: number, groupId: number, input: OpeningHours | null): void {
  assertGroup(db, facilityId, groupId)
  save(db, facilityId, groupId, input)
}
