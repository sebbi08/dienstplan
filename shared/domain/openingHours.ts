import { weekday } from './dates'
import type { IsoDate, Minutes } from './types'

/** One weekday: both times null and not closed = not entered. */
export interface DayHours {
  open: Minutes | null
  close: Minutes | null
  closed: boolean
}

export interface OpeningHours {
  /** Monday to Friday. */
  days: DayHours[]
  /** Minimum number of staff at opening / until closing. */
  minAtOpening: number
  minAtClosing: number
}

/** Weekday mask bits Monday to Friday. */
export const WEEKDAY_BITS = [1, 2, 4, 8, 16]
export const ALL_WEEKDAYS = 31

/** The entry of the date's weekday; null without hours or on a weekend. */
export function hoursOn(hours: OpeningHours | null, date: IsoDate): DayHours | null {
  if (hours === null) return null
  return hours.days[weekday(date)] ?? null
}

/** Opening and closing time set and not closed: the day's edges are checked. */
export function isEntered(day: DayHours | null): day is DayHours & { open: Minutes; close: Minutes } {
  return day !== null && !day.closed && day.open !== null && day.close !== null
}

/** Whether a weekday mask contains the date's weekday (never on a weekend). */
export function ruleAppliesOn(weekdays: number, date: IsoDate): boolean {
  const index = weekday(date)
  return index < WEEKDAY_BITS.length && (weekdays & WEEKDAY_BITS[index]!) !== 0
}
