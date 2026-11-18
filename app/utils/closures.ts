import { addDays, isWeekend, toIsoDate } from '#shared/domain/dates'
import type { IsoDate } from '#shared/domain/types'

/**
 * The closures page's list for one year: the closures overlapping it (starting on or before 31 December and ending on
 * or after 1 January), so a closure across the turn of the year shows in both years. Keeps the given order. Filtered on
 * the client: a facility has only a few closures a year, so the page loads them all once.
 */
export function closuresInYear<T extends { startDate: IsoDate; endDate: IsoDate }>(list: readonly T[], year: number): T[] {
  const first = toIsoDate(year, 1, 1)
  const last = toIsoDate(year, 12, 31)
  return list.filter(closure => closure.startDate <= last && closure.endDate >= first)
}

/**
 * The Von/Bis a new closure starts with: today when it lies in the shown year, otherwise that year's first working day,
 * i.e. the first Monday to Friday from 2 January on (1 January is a public holiday everywhere, and 2 to 5 January always
 * hold a weekday, so no other holiday such as Epiphany can be that day).
 */
export function closureDefaultDate(today: IsoDate, year: number): IsoDate {
  if (today.startsWith(`${year}-`)) return today
  let date = toIsoDate(year, 1, 2)
  while (isWeekend(date)) date = addDays(date, 1)
  return date
}

/** The year in the page's address (?year=2027), or the current year when it is missing or implausible. */
export function closureYearFromQuery(value: unknown, currentYear: number): number {
  const year = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : currentYear
}
