import { daysInMonth, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

export type ChildStatus = 'planned' | 'active' | 'archived'

/** Archived the day after leaving; active from the entry day on; otherwise planned (no or future entry date). */
export function childStatus(child: { entryDate: IsoDate | null; leftOn: IsoDate | null }, today: IsoDate): ChildStatus {
  if (child.leftOn !== null && today > child.leftOn) return 'archived'
  if (child.entryDate !== null && child.entryDate <= today) return 'active'
  return 'planned'
}

/** The same calendar day `year` of the given year; 29 February falls on 28 February in non-leap years. */
function inYear(date: IsoDate, year: number): IsoDate {
  const { month, day } = parseIsoDate(date)
  return toIsoDate(year, month, Math.min(day, daysInMonth(year, month)))
}

/** Day from which a record is purged: the leaving day plus whole years. */
export function purgeDate(leftOn: IsoDate, years: number): IsoDate {
  return inYear(leftOn, parseIsoDate(leftOn).year + years)
}

/**
 * Completed years and months on a day (a month counts once its day of month is reached). A birth day the month does
 * not have (29-31) counts on the month's last day, so a 29 February child turns a year older on 28 February in
 * non-leap years, as `nextBirthday` says.
 */
export function ageOn(birthDate: IsoDate, date: IsoDate): { years: number; months: number } {
  const birth = parseIsoDate(birthDate)
  const on = parseIsoDate(date)
  let total = (on.year - birth.year) * 12 + (on.month - birth.month)
  if (on.day < Math.min(birth.day, daysInMonth(on.year, on.month))) total -= 1
  return { years: Math.floor(total / 12), months: total % 12 }
}

/** The next birthday on or after today (today counts) and the age turned; 29 February becomes 28 February in non-leap years. */
export function nextBirthday(birthDate: IsoDate, today: IsoDate): { date: IsoDate; turns: number } {
  const birthYear = parseIsoDate(birthDate).year
  let year = parseIsoDate(today).year
  let date = inYear(birthDate, year)
  if (date < today) {
    year += 1
    date = inYear(birthDate, year)
  }
  return { date, turns: year - birthYear }
}
