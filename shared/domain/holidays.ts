import { addDays, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

export type HolidayKey =
  | 'new_year' | 'epiphany' | 'good_friday' | 'easter_monday' | 'labour_day'
  | 'ascension_day' | 'whit_monday' | 'corpus_christi' | 'german_unity_day'
  | 'all_saints_day' | 'christmas_day' | 'boxing_day'

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return toIsoDate(year, month, day)
}

const cache = new Map<number, Map<IsoDate, HolidayKey>>()

export function bwHolidays(year: number): Map<IsoDate, HolidayKey> {
  const cached = cache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const holidays = new Map<IsoDate, HolidayKey>([
    [toIsoDate(year, 1, 1), 'new_year'],
    [toIsoDate(year, 1, 6), 'epiphany'],
    [addDays(easter, -2), 'good_friday'],
    [addDays(easter, 1), 'easter_monday'],
    [toIsoDate(year, 5, 1), 'labour_day'],
    [addDays(easter, 39), 'ascension_day'],
    [addDays(easter, 50), 'whit_monday'],
    [addDays(easter, 60), 'corpus_christi'],
    [toIsoDate(year, 10, 3), 'german_unity_day'],
    [toIsoDate(year, 11, 1), 'all_saints_day'],
    [toIsoDate(year, 12, 25), 'christmas_day'],
    [toIsoDate(year, 12, 26), 'boxing_day'],
  ])
  cache.set(year, holidays)
  return holidays
}

export function holidayOn(iso: IsoDate): HolidayKey | null {
  return bwHolidays(parseIsoDate(iso).year).get(iso) ?? null
}

export function isHoliday(iso: IsoDate): boolean {
  return holidayOn(iso) !== null
}
