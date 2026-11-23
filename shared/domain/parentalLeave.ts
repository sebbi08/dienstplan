import { addDays, daysBetween, parseIsoDate, toIsoDate } from './dates'
import { monthEnd } from './statutoryLeave'
import type { IsoDate } from './types'

/**
 * Elternzeit (BEEG) of an employee: periods with start and end (both inclusive), optionally with part-time work at the
 * facility during it. Contract data: entered by whoever edits the contract (employees.contractEdit), seen with
 * employees.contractView. Nothing here is legal advice; the hints never block saving except where noted.
 *
 * - A full Elternzeit (no part time): no working days, no target hours (Soll 0), the plan marks the days.
 * - Part time (at most 32 hours a week, § 15 Abs. 4 BEEG): the target follows the part-time hours on the usual working
 *   days of the contract; the weekly hours before and after stay as they are.
 * - Leave (§ 17 Abs. 1 BEEG): only when the employer declares it (`reduceLeave`, off by default) the year's entitlement
 *   is cut by 1/12 per full calendar month of a full Elternzeit (never during part-time work at the facility).
 * - Remaining leave from before the Elternzeit is carried to the year of the return and the year after (§ 17 Abs. 2).
 * - TVöD: the Elternzeit does not count towards the level years (§ 17 Abs. 3 TVöD), so a level step moves by its days.
 */

export interface ParentalLeavePeriod {
  start: IsoDate
  end: IsoDate
  /** Part-time work at the facility during the Elternzeit (minutes per week); null = full Elternzeit. */
  partTimeWeeklyMinutes: number | null
  /** The employer cuts the leave (§ 17 Abs. 1 BEEG). */
  reduceLeave: boolean
}

/** § 15 Abs. 4 BEEG: at most 32 hours a week during the Elternzeit. */
export const PARENTAL_LEAVE_PART_TIME_MAX_MINUTES = 32 * 60
/** § 16 Abs. 1 Satz 6 BEEG: up to three sections per child; a fourth needs the employer's consent (a hint only). */
export const PARENTAL_LEAVE_MAX_SECTIONS = 3
/** § 15 Abs. 2 BEEG: up to three years per child (a hint only). */
export const PARENTAL_LEAVE_MAX_MONTHS = 36
/** The longest duration the dialog takes in months (one section). */
export const PARENTAL_LEAVE_DURATION_MAX_MONTHS = 36
export const PARENTAL_LEAVE_NOTE_MAX = 2000
/** The return is announced this many days before the first working day after the Elternzeit (4 weeks). */
export const PARENTAL_LEAVE_RETURN_NOTICE_DAYS = 28

/** The last day of an Elternzeit of `months` months from `start` (start + n months − 1 day; 31.01. + 1 month → 28./29.02.). */
export function parentalLeaveEnd(start: IsoDate, months: number): IsoDate {
  return monthEnd(start, months)
}

/** Full months and the days beyond them from `start` to `end` (both inclusive); 0/0 when the end lies before the start. */
export function parentalLeaveLength(start: IsoDate, end: IsoDate): { months: number; days: number } {
  if (end < start) return { months: 0, days: 0 }
  let months = 0
  while (monthEnd(start, months + 1) <= end) months++
  return { months, days: months === 0 ? daysBetween(start, end) + 1 : daysBetween(monthEnd(start, months), end) }
}

/** The length in months as a number (a day beyond the full months counting 1/30), for the total per child. */
function lengthInMonths(start: IsoDate, end: IsoDate): number {
  const { months, days } = parentalLeaveLength(start, end)
  return months + days / 30
}

/** § 15 Abs. 2 BEEG: the Elternzeit ends at the latest the day before the child's 8th birthday. */
export function lastParentalLeaveDay(childBirthDate: IsoDate): IsoDate {
  return monthEnd(childBirthDate, 96)
}

/** The period the date lies in (null outside every period). */
export function parentalLeaveOn<T extends Pick<ParentalLeavePeriod, 'start' | 'end'>>(periods: readonly T[] | undefined, date: IsoDate): T | null {
  return periods?.find(period => period.start <= date && date <= period.end) ?? null
}

/** A full Elternzeit (no part-time work) on the date. */
export function fullParentalLeaveOn(periods: readonly ParentalLeavePeriod[] | undefined, date: IsoDate): boolean {
  const period = parentalLeaveOn(periods, date)
  return period !== null && period.partTimeWeeklyMinutes === null
}

/** The days from `from` to `to` (inclusive) covered by at least one of the periods. */
export function coveredDays(periods: readonly Pick<ParentalLeavePeriod, 'start' | 'end'>[], from: IsoDate, to: IsoDate): number {
  const spans = periods
    .map(period => ({ start: period.start > from ? period.start : from, end: period.end < to ? period.end : to }))
    .filter(span => span.start <= span.end)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  let count = 0
  let reached: IsoDate | null = null
  for (const span of spans) {
    const start = reached !== null && span.start <= reached ? addDays(reached, 1) : span.start
    if (start > span.end) continue
    count += daysBetween(start, span.end) + 1
    reached = span.end
  }
  return count
}

/**
 * The full calendar months of the year in which the leave is cut (§ 17 Abs. 1 BEEG): every day of the month lies in a
 * full Elternzeit (no part time) for which the employer declared the cut; adjoining periods count together.
 */
export function leaveCutMonths(periods: readonly ParentalLeavePeriod[] | undefined, year: number): number {
  const cutting = (periods ?? []).filter(period => period.reduceLeave && period.partTimeWeeklyMinutes === null)
  if (cutting.length === 0) return 0
  let months = 0
  for (let month = 1; month <= 12; month++) {
    const first = toIsoDate(year, month, 1)
    const last = addDays(toIsoDate(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1)
    if (coveredDays(cutting, first, last) === daysBetween(first, last) + 1) months++
  }
  return months
}

const hundredths = (days: number) => Math.round(days * 100) / 100

/**
 * The year's entitlement after the cut of `months` twelfths: what is left is rounded as the BUrlG rounds parts of a year
 * (§ 5 Abs. 2: a fraction of at least half a day becomes a full day, a smaller one stays, shown to hundredths), so the
 * rounding favours the employee. Answers the days left and the days cut.
 */
export function cutEntitlement(days: number, months: number): { days: number; cut: number } {
  if (months <= 0 || days <= 0) return { days, cut: 0 }
  const exact = Math.round((days * Math.max(0, 12 - Math.min(12, months))) / 12 * 1e6) / 1e6
  const whole = Math.floor(exact)
  const left = hundredths(exact - whole >= 0.5 ? whole + 1 : exact)
  return { days: left, cut: hundredths(days - left) }
}

/**
 * The year until which the remaining leave of `year` stays (§ 17 Abs. 2 BEEG: leave not taken before the Elternzeit is
 * granted in the year of the return or the year after): the latest 31 December of the year after a return, over the full
 * Elternzeit periods that begin by the forfeiture day of `year` and whose protection reaches past it. Null when no
 * Elternzeit protects that leave (the forfeiture day applies as usual).
 */
export function leaveProtectedUntil(
  periods: readonly ParentalLeavePeriod[] | undefined, forfeitDate: IsoDate,
): IsoDate | null {
  let until: IsoDate | null = null
  for (const period of periods ?? []) {
    if (period.partTimeWeeklyMinutes !== null || period.start > forfeitDate) continue
    const protectedUntil = toIsoDate(parseIsoDate(addDays(period.end, 1)).year + 1, 12, 31)
    if (protectedUntil >= forfeitDate && (until === null || protectedUntil > until)) until = protectedUntil
  }
  return until
}

/**
 * The days a TVöD level step moves (§ 17 Abs. 3 TVöD: an Elternzeit interrupts the level years without harm but does not
 * count): the days of full Elternzeit from the start of the level years up to the moved day, so an Elternzeit in an
 * earlier step moves the later ones as well. Part-time work during the Elternzeit counts as time of service.
 */
export function levelShiftDays(periods: readonly ParentalLeavePeriod[] | undefined, since: IsoDate, nominal: IsoDate): number {
  const full = (periods ?? []).filter(period => period.partTimeWeeklyMinutes === null)
  if (full.length === 0) return 0
  let shift = 0
  for (;;) {
    const days = coveredDays(full, since, addDays(nominal, shift - 1))
    if (days === shift) return shift
    shift = days
  }
}

/** The first day after `end` that `isWorkingDay` accepts, looking at most two years ahead (null when none). */
export function firstWorkingDayAfter(end: IsoDate, isWorkingDay: (date: IsoDate) => boolean): IsoDate | null {
  let date = addDays(end, 1)
  for (let step = 0; step < 731; step++, date = addDays(date, 1)) if (isWorkingDay(date)) return date
  return null
}

/** What makes a period invalid (the server refuses to save it). */
export type ParentalLeaveError = 'end_before_start' | 'before_birth' | 'after_eighth_birthday' | 'overlap'
/** Hints that never block: more than three sections per child, more than three years per child. */
export type ParentalLeaveHint = 'sections' | 'total'

export interface ParentalLeaveCheck {
  error: ParentalLeaveError | null
  hints: ParentalLeaveHint[]
  /** Sections of the child including this one. */
  sections: number
  /** Months of Elternzeit for the child including this one (a day counting 1/30 month), rounded to tenths. */
  totalMonths: number
}

/**
 * Checks a period against the child's birth and the person's other periods (`others`, without the period itself): the
 * end not before the start, the start not before the birth, the end not after the day before the 8th birthday (§ 15
 * Abs. 2 BEEG), no overlap with another Elternzeit of the person. Hints: more than three sections for the child (§ 16
 * Abs. 1 BEEG, a fourth needs the employer's consent) and more than 36 months for the child in all.
 */
export function checkParentalLeave(
  period: { childBirthDate: IsoDate; start: IsoDate; end: IsoDate },
  others: readonly { childBirthDate: IsoDate; start: IsoDate; end: IsoDate }[],
): ParentalLeaveCheck {
  const sameChild = others.filter(other => other.childBirthDate === period.childBirthDate)
  const sections = sameChild.length + 1
  const totalMonths = Math.round([...sameChild, period].reduce((sum, item) => sum + lengthInMonths(item.start, item.end), 0) * 10) / 10
  const hints: ParentalLeaveHint[] = []
  if (sections > PARENTAL_LEAVE_MAX_SECTIONS) hints.push('sections')
  if (totalMonths > PARENTAL_LEAVE_MAX_MONTHS) hints.push('total')
  const error: ParentalLeaveError | null = period.end < period.start
    ? 'end_before_start'
    : period.start < period.childBirthDate
      ? 'before_birth'
      : period.end > lastParentalLeaveDay(period.childBirthDate)
        ? 'after_eighth_birthday'
        : others.some(other => other.start <= period.end && period.start <= other.end) ? 'overlap' : null
  return { error, hints, sections, totalMonths }
}

/** The reminder „‹Name› kommt am ‹Datum› aus der Elternzeit zurück“: 4 weeks before through the day (null otherwise). */
export function returnReminderState(firstWorkingDay: IsoDate, today: IsoDate): 'upcoming' | 'today' | null {
  if (today > firstWorkingDay || today < addDays(firstWorkingDay, -PARENTAL_LEAVE_RETURN_NOTICE_DAYS)) return null
  return today === firstWorkingDay ? 'today' : 'upcoming'
}
