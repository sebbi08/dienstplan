import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { weekday } from '../../shared/domain/dates'
import {
  UNLOCK_GRACE_SECONDS, berlinDate, noLockPeriods, unlockDeadline, windowsOnDay, type NoLockPeriod, type TimeWindow,
} from '../../shared/domain/tablet'
import type { IsoDate } from '../../shared/domain/types'
import { isCheckedDay } from '../../shared/domain/warnings'
import type { Db } from '../db/client'
import { closures, facilities, openingHours, tabletUnlockedWindows, terminalUnlocks } from '../db/schema'
import { facilityPublicHolidayRules } from './holidayRules'
import { closureColumns, closureOn } from './queries'

// Opening hours, closures and their services import this file (they delete expired unlocks before saving), so the
// calendar is read here directly rather than through them.

/** A day the facility is open, with its opening hours of that weekday (null = none entered). */
export interface OpenDay { hours: TimeWindow | null }

/** The facility's own opening hours (not a group's) by weekday (0 = Monday). */
function facilityHourRows(db: Db, facilityId: number) {
  return new Map(db.select().from(openingHours)
    .where(and(eq(openingHours.facilityId, facilityId), isNull(openingHours.groupId))).all()
    .map(row => [row.weekday, row]))
}

/**
 * The facility's days from `from` to `to`: null when it is closed (not a care day as the staffing report counts them –
 * weekend, public holiday of its state, closure day or Schließzeit – or a weekday its opening hours mark closed), else
 * the day's opening hours. Reads the calendar once; only the closures touching the range.
 */
export function facilityOpenDays(db: Db, facilityId: number, from: IsoDate, to: IsoDate): (date: IsoDate) => OpenDay | null {
  const touching = db.select(closureColumns).from(closures)
    .where(and(eq(closures.facilityId, facilityId), gte(closures.endDate, from), lte(closures.startDate, to))).all()
  const holidays = facilityPublicHolidayRules(db, facilityId)
  const days = facilityHourRows(db, facilityId)
  return (date) => {
    if (!isCheckedDay(date, closureOn(touching, date) !== null, holidays)) return null
    const day = days.get(weekday(date))
    if (day?.closed) return null
    return { hours: day && day.open !== null && day.close !== null ? { start: day.open, end: day.close } : null }
  }
}

/** Whether the facility's opening hours give times (or „geschlossen“) for every weekday Monday to Friday. */
export function hasOpeningHoursEveryWeekday(db: Db, facilityId: number): boolean {
  const days = facilityHourRows(db, facilityId)
  return [0, 1, 2, 3, 4].map(index => days.get(index))
    .every(day => day !== undefined && (day.closed || (day.open !== null && day.close !== null)))
}

/** The facility's windows without the automatic lock, by start. */
export function getNoLockWindows(db: Db, facilityId: number): TimeWindow[] {
  return db.select({ start: tabletUnlockedWindows.start, end: tabletUnlockedWindows.end }).from(tabletUnlockedWindows)
    .where(eq(tabletUnlockedWindows.facilityId, facilityId))
    .orderBy(asc(tabletUnlockedWindows.start), asc(tabletUnlockedWindows.end)).all()
}

/**
 * The stretches without the automatic lock on the given days (Berlin dates): only open days of the facility, the
 * windows cut to each day's opening hours (windowsOnDay). No windows: none, without reading the calendar.
 */
export function noLockPeriodsOn(db: Db, facilityId: number, windows: readonly TimeWindow[], dates: readonly IsoDate[]): NoLockPeriod[] {
  if (windows.length === 0 || dates.length === 0) return []
  const sorted = [...new Set(dates)].sort()
  const openDay = facilityOpenDays(db, facilityId, sorted[0]!, sorted.at(-1)!)
  return sorted.flatMap((date) => {
    const day = openDay(date)
    return day ? noLockPeriods(windowsOnDay(windows, day.hours), date) : []
  })
}

/**
 * The moment after which the server no longer accepts an unlock that was last used at lastActiveAt: the lock time plus
 * grace after the last use, or after the end of a window of that day the unlock reached (unlockDeadline). `periods`
 * must hold the stretches of the day of the last use.
 */
export function validUntil(lastActiveAt: string, lockMinutes: number, periods: readonly NoLockPeriod[]): number {
  return unlockDeadline(Date.parse(lastActiveAt), (lockMinutes * 60 + UNLOCK_GRACE_SECONDS) * 1000, periods)
}

/**
 * Deletes the unlocks no tablet would accept any more, whichever facility; returns how many. Expiry is decided with the
 * settings as they are now (call it before changing them, so a new window does not revive an unlock that ran out).
 */
export function deleteExpiredUnlocks(db: Db, now: Date): number {
  const rows = db.select().from(terminalUnlocks).all()
  if (rows.length === 0) return 0
  const lockMinutes = new Map(db.select({ id: facilities.id, minutes: facilities.tabletLockMinutes }).from(facilities).all()
    .map(facility => [facility.id, facility.minutes]))
  const windows = new Map<number, TimeWindow[]>()
  for (const { facilityId, start, end } of db.select().from(tabletUnlockedWindows).all()) {
    windows.set(facilityId, [...windows.get(facilityId) ?? [], { start, end }])
  }
  // Per facility the stretches of all days of the last uses, the calendar read once.
  const periods = new Map<number, NoLockPeriod[]>()
  for (const facilityId of new Set(rows.map(row => row.facilityId))) {
    const days = rows.filter(row => row.facilityId === facilityId).map(row => berlinDate(Date.parse(row.lastActiveAt)))
    periods.set(facilityId, noLockPeriodsOn(db, facilityId, windows.get(facilityId) ?? [], days))
  }
  const expired = rows
    .filter(row => now.getTime() > validUntil(row.lastActiveAt, lockMinutes.get(row.facilityId) ?? 0, periods.get(row.facilityId) ?? []))
    .map(row => row.id)
  if (expired.length > 0) db.delete(terminalUnlocks).where(inArray(terminalUnlocks.id, expired)).run()
  return expired.length
}
