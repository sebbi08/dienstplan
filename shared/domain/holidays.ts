import { addDays, parseIsoDate, toIsoDate, weekday } from './dates'
import type { GermanState } from './states'
import type { IsoDate } from './types'

export type HolidayKey =
  | 'new_year' | 'epiphany' | 'good_friday' | 'easter_monday' | 'labour_day'
  | 'ascension_day' | 'whit_monday' | 'corpus_christi' | 'german_unity_day'
  | 'all_saints_day' | 'christmas_day' | 'boxing_day'
  | 'womens_day' | 'assumption_day' | 'childrens_day' | 'reformation_day' | 'repentance_day'

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

export interface HolidayRules {
  state: GermanState
  /** Mariä Himmelfahrt is a public holiday in Bavaria only where the municipality keeps it; effective for BY only. */
  assumptionDay: boolean
}

export const BW_RULES: HolidayRules = { state: 'BW', assumptionDay: true }

const EPIPHANY: readonly GermanState[] = ['BW', 'BY', 'ST']
const WOMENS_DAY: readonly GermanState[] = ['BE', 'MV']
const CORPUS_CHRISTI: readonly GermanState[] = ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']
const REFORMATION_DAY: readonly GermanState[] = ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']
const ALL_SAINTS_DAY: readonly GermanState[] = ['BW', 'BY', 'NW', 'RP', 'SL']

/** The Wednesday before 23 November, i.e. the Wednesday in 16-22 November. */
function repentanceDay(year: number): IsoDate {
  const nov22 = toIsoDate(year, 11, 22)
  return addDays(nov22, -((weekday(nov22) - 2 + 7) % 7))
}

const cache = new Map<string, Map<IsoDate, HolidayKey>>()

/** The holidays of the year under these rules; cached, so callers must not change the map. */
export function holidaysOf(rules: HolidayRules, year: number): ReadonlyMap<IsoDate, HolidayKey> {
  const { state } = rules
  const assumptionDay = state === 'BY' && rules.assumptionDay
  const cacheKey = `${state}:${assumptionDay}:${year}`
  const cached = cache.get(cacheKey)
  if (cached) return cached
  const easter = easterSunday(year)
  const holidays = new Map<IsoDate, HolidayKey>([
    [toIsoDate(year, 1, 1), 'new_year'],
    [addDays(easter, -2), 'good_friday'],
    [addDays(easter, 1), 'easter_monday'],
    [toIsoDate(year, 5, 1), 'labour_day'],
    [addDays(easter, 39), 'ascension_day'],
    [addDays(easter, 50), 'whit_monday'],
    [toIsoDate(year, 10, 3), 'german_unity_day'],
    [toIsoDate(year, 12, 25), 'christmas_day'],
    [toIsoDate(year, 12, 26), 'boxing_day'],
  ])
  if (EPIPHANY.includes(state)) holidays.set(toIsoDate(year, 1, 6), 'epiphany')
  if (WOMENS_DAY.includes(state)) holidays.set(toIsoDate(year, 3, 8), 'womens_day')
  if (CORPUS_CHRISTI.includes(state)) holidays.set(addDays(easter, 60), 'corpus_christi')
  if (state === 'SL' || assumptionDay) holidays.set(toIsoDate(year, 8, 15), 'assumption_day')
  if (state === 'TH') holidays.set(toIsoDate(year, 9, 20), 'childrens_day')
  if (REFORMATION_DAY.includes(state)) holidays.set(toIsoDate(year, 10, 31), 'reformation_day')
  if (ALL_SAINTS_DAY.includes(state)) holidays.set(toIsoDate(year, 11, 1), 'all_saints_day')
  if (state === 'SN') holidays.set(repentanceDay(year), 'repentance_day')
  cache.set(cacheKey, holidays)
  return holidays
}

export function holidayIn(iso: IsoDate, rules: HolidayRules): HolidayKey | null {
  return holidaysOf(rules, parseIsoDate(iso).year).get(iso) ?? null
}

export function isHolidayIn(iso: IsoDate, rules: HolidayRules): boolean {
  return holidayIn(iso, rules) !== null
}
