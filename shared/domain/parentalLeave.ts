import { addDays, daysBetween, parseIsoDate, toIsoDate } from './dates'
import { monthEnd, roundPart } from './statutoryLeave'
import type { IsoDate } from './types'

/**
 * Elternzeit (BEEG) of an employee: periods with start and end (both inclusive), optionally with part-time work at the
 * facility during it. Contract data: entered by whoever edits the contract (employees.contractEdit), seen with
 * employees.contractView. Nothing here is legal advice; the hints never block saving except where noted.
 *
 * - A full Elternzeit (no part time): no working days, no target hours (Soll 0), the plan marks the days.
 * - Part time (at most 32 hours a week, § 15 Abs. 4 BEEG): the target follows the part-time hours on its own working
 *   days (default: the contract's); the weekly hours before and after stay as they are.
 * - Leave (§ 17 Abs. 1 BEEG): only when the employer declares it (`reduceLeave`, off by default) the year's entitlement
 *   is cut by 1/12 per full calendar month of a full Elternzeit (never during part-time work at the facility).
 * - Remaining leave of a year the Elternzeit reaches into is carried to the year of the return and the year after
 *   (§ 17 Abs. 2); the notice on remaining leave moves to that date.
 * - TVöD: the Elternzeit does not count towards the level years (§ 17 Abs. 3 TVöD), so a level step moves by its days
 *   (an approximation: more than five years in a row and lit. e are hints only).
 */

export interface ParentalLeavePeriod {
  start: IsoDate
  end: IsoDate
  /** Part-time work at the facility during the Elternzeit (minutes per week); null = full Elternzeit. */
  partTimeWeeklyMinutes: number | null
  /**
   * The working days of the part-time work (bitmask, bit 0 = Monday; shared/domain/targets.ts); null = the contract's
   * working days. Only with part time.
   */
  partTimeWorkdays?: number | null
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
  // The same rounding as the statutory part of a year (statutoryLeave.ts roundPart), shown to hundredths.
  const left = hundredths(roundPart((days * Math.max(0, 12 - Math.min(12, months))) / 12))
  return { days: left, cut: hundredths(days - left) }
}

export interface LeaveProtection {
  /** The last day the remaining leave can be taken: 31 December of the year after the return. */
  until: IsoDate
  /** The first day after that Elternzeit (the return). */
  returnDay: IsoDate
}

/**
 * Whether the remaining leave of `year` is kept from lapsing on its forfeiture day (§ 17 Abs. 2 BEEG: leave not taken
 * before the Elternzeit – and, by the case law, leave arising during it – is granted in the year of the return or the
 * year after): an Elternzeit (full or part time) that reaches into the year (ends on or after 1 January) and begins by
 * the year's forfeiture day, and whose protection (31 December of the year after the return) lasts past that day. The
 * latest such protection wins. Null: the forfeiture day applies as usual (also for the leave of a year that begins only
 * after the return).
 */
export function leaveProtection(
  periods: readonly ParentalLeavePeriod[] | undefined, year: number, forfeitDate: IsoDate,
): LeaveProtection | null {
  let found: LeaveProtection | null = null
  for (const period of periods ?? []) {
    if (period.end < toIsoDate(year, 1, 1) || period.start > forfeitDate) continue
    const returnDay = addDays(period.end, 1)
    const until = toIsoDate(parseIsoDate(returnDay).year + 1, 12, 31)
    if (until >= forfeitDate && (found === null || until > found.until)) found = { until, returnDay }
  }
  return found
}

/** The last day the remaining leave of `year` can be taken because of an Elternzeit (leaveProtection; null = none). */
export function leaveProtectedUntil(
  periods: readonly ParentalLeavePeriod[] | undefined, year: number, forfeitDate: IsoDate,
): IsoDate | null {
  return leaveProtection(periods, year, forfeitDate)?.until ?? null
}

/** The notice on remaining leave starts this many months before a protected year's last day (the usual window is ~6). */
export const PROTECTED_NOTICE_MONTHS = 6

/**
 * The notice window of a protected year's remaining leave: PROTECTED_NOTICE_MONTHS before the last day (1 July of the
 * year after the return; the return always lies before it) up to and including the last day.
 */
export function protectedNoticeFrom(protection: Pick<LeaveProtection, 'until'>): IsoDate {
  return toIsoDate(parseIsoDate(protection.until).year, 12 - PROTECTED_NOTICE_MONTHS + 1, 1)
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

/** § 17 Abs. 3 Satz 2 TVöD: an Elternzeit of up to five years each interrupts without harm. */
export const LEVEL_HARMLESS_BREAK_YEARS = 5

/**
 * Hints on a moved level step (never computed in): `longBreak` – a full Elternzeit (adjoining sections together) of more
 * than five years within the level years up to the step: the person is put on the level before the one reached
 * (§ 17 Abs. 3 Satz 3 TVöD); `shortBreak` – a calendar year with less than a month of full Elternzeit: such a short
 * interruption may count as level time (§ 17 Abs. 3 Satz 1 lit. e TVöD, whether it covers Elternzeit is disputed).
 */
export type LevelShiftHint = 'longBreak' | 'shortBreak'

export function levelShiftHints(periods: readonly ParentalLeavePeriod[] | undefined, since: IsoDate, until: IsoDate): LevelShiftHint[] {
  const full = (periods ?? []).filter(period => period.partTimeWeeklyMinutes === null && period.end >= since && period.start <= until)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const spans: { start: IsoDate; end: IsoDate }[] = []
  for (const period of full) {
    const last = spans.at(-1)
    if (last && period.start <= addDays(last.end, 1)) {
      if (period.end > last.end) last.end = period.end
    }
    else spans.push({ start: period.start, end: period.end })
  }
  const hints: LevelShiftHint[] = []
  const tooLong = (span: { start: IsoDate; end: IsoDate }) => span.end > monthEnd(span.start, LEVEL_HARMLESS_BREAK_YEARS * 12)
  if (spans.some(tooLong)) hints.push('longBreak')
  const years = new Set(full.flatMap(period => {
    const list: number[] = []
    for (let year = parseIsoDate(period.start).year; year <= parseIsoDate(period.end).year; year++) list.push(year)
    return list
  }))
  const short = [...years].some((year) => {
    const first = toIsoDate(year, 1, 1)
    const days = coveredDays(full, first > since ? first : since, toIsoDate(year, 12, 31) < until ? toIsoDate(year, 12, 31) : until)
    return days > 0 && days < 30
  })
  if (short) hints.push('shortBreak')
  return hints
}

/** The first day after `end` that `isWorkingDay` accepts, looking at most two years ahead (null when none). */
export function firstWorkingDayAfter(end: IsoDate, isWorkingDay: (date: IsoDate) => boolean): IsoDate | null {
  let date = addDays(end, 1)
  for (let step = 0; step < 731; step++, date = addDays(date, 1)) if (isWorkingDay(date)) return date
  return null
}

/** What makes a period invalid (the server refuses to save it). */
export type ParentalLeaveError = 'end_before_start' | 'before_birth' | 'after_eighth_birthday' | 'overlap'
/**
 * Hints that never block: more than three sections per child, more than the child's 36 months (with the mother's
 * Mutterschutz after the birth), more than 24 months between the 3rd and the 8th birthday.
 */
export type ParentalLeaveHint = 'sections' | 'total' | 'afterThird'

/** § 15 Abs. 2 Satz 2 BEEG: up to 24 months between the 3rd and the 8th birthday. */
export const PARENTAL_LEAVE_MAX_MONTHS_AFTER_THIRD = 24

/**
 * The months the summaries and hints show are days / (365.25 / 12) – an average month – to one decimal. The limits
 * themselves are counted in days: the 36 months are the days from the birth to the day before the 3rd birthday
 * (entitlementDays, 1095 or 1096), so a period of exactly 36 calendar months fits.
 */
export const AVERAGE_MONTH_DAYS = 365.25 / 12

/** Days as months (AVERAGE_MONTH_DAYS), to one decimal. */
export function daysToMonths(days: number): number {
  return Math.round((days / AVERAGE_MONTH_DAYS) * 10) / 10
}

/** The days of the child's 36 months of Elternzeit (§ 15 Abs. 2 Satz 1 BEEG): from the birth to the day before the 3rd birthday. */
export function entitlementDays(childBirthDate: IsoDate): number {
  return daysBetween(childBirthDate, monthEnd(childBirthDate, PARENTAL_LEAVE_MAX_MONTHS)) + 1
}

/** A period with its start and end (inclusive). */
interface Span { start: IsoDate; end: IsoDate }

/** The span of the Mutterschutz after the birth (from the birth to its last day). */
export interface ProtectionSpan { from: IsoDate; to: IsoDate }

/** Days covered by the spans (overlaps once), however far they reach. */
const daysOf = (spans: readonly Span[]) => (spans.length === 0 ? 0 : coveredDays(spans, '0000-01-01', '9999-12-31'))

export interface ChildLeaveSummary {
  /** The child's 36 months in days (entitlementDays). */
  totalDays: number
  /** The mother's Mutterschutz after the birth (0 without one). */
  protectionDays: number
  /** The Elternzeit entered for the child. */
  plannedDays: number
  /** What is still possible: the 36 months minus the Mutterschutz and the Elternzeit (days counted once; below 0 = too much). */
  remainingDays: number
}

/**
 * The child's summary „36 Monate insgesamt · davon Mutterschutz … · Elternzeit eingetragen … · noch möglich …“: the
 * mother's Mutterschutz after the birth counts towards the 36 months (§ 15 Abs. 2 Satz 3 BEEG); a day in both counts once.
 */
export function childLeaveSummary(childBirthDate: IsoDate, periods: readonly Span[], protection: ProtectionSpan | null): ChildLeaveSummary {
  const protectionSpans = protection ? [{ start: protection.from, end: protection.to }] : []
  const totalDays = entitlementDays(childBirthDate)
  return {
    totalDays, protectionDays: daysOf(protectionSpans), plannedDays: daysOf(periods),
    remainingDays: totalDays - daysOf([...protectionSpans, ...periods]),
  }
}

export interface ParentalLeaveCheck {
  error: ParentalLeaveError | null
  hints: ParentalLeaveHint[]
  /** Sections of the child including this one. */
  sections: number
  /** Months of Elternzeit for the child including this one and the Mutterschutz after the birth when given (daysToMonths). */
  totalMonths: number
  /** What was still possible for the child before this period (the 36 months minus the Mutterschutz and the others; daysToMonths). */
  remainingMonths: number
  /** Months of the child's Elternzeit between the 3rd and the 8th birthday (daysToMonths). */
  monthsAfterThird: number
}

interface CheckedPeriod { childId?: number | null; childBirthDate: IsoDate; start: IsoDate; end: IsoDate }

/** The same child: by the child of the personnel file when both name one (twins share a birth date), else by the birth date. */
export const sameChildAs = (a: Pick<CheckedPeriod, 'childId' | 'childBirthDate'>, b: Pick<CheckedPeriod, 'childId' | 'childBirthDate'>) =>
  a.childId != null && b.childId != null ? a.childId === b.childId : a.childBirthDate === b.childBirthDate

/** The part of the period between the 3rd birthday and the day before the 8th (null when none). */
function afterThirdOf(item: CheckedPeriod): Span | null {
  const third = addDays(monthEnd(item.childBirthDate, PARENTAL_LEAVE_MAX_MONTHS), 1)
  const start = item.start > third ? item.start : third
  return item.end < start ? null : { start, end: item.end }
}

/**
 * Checks a period against the child's birth and the person's other periods (`others`, without the period itself): the
 * end not before the start, the start not before the birth, the end not after the day before the 8th birthday (§ 15
 * Abs. 2 BEEG), no overlap with another Elternzeit of the person. Hints: more than three sections for the child (§ 16
 * Abs. 1 BEEG, a fourth needs the employer's consent), more than the child's 36 months – the mother's Mutterschutz after
 * the birth counts towards them (§ 15 Abs. 2 Satz 3; `protectionAfterBirth`, when known; see childLeaveSummary) – and
 * more than 24 months between the 3rd and the 8th birthday (§ 15 Abs. 2 Satz 2).
 */
export function checkParentalLeave(
  period: CheckedPeriod, others: readonly CheckedPeriod[], protectionAfterBirth: ProtectionSpan | null = null,
): ParentalLeaveCheck {
  const sameChild = others.filter(other => sameChildAs(other, period))
  const sections = sameChild.length + 1
  const all = [...sameChild, period]
  const before = childLeaveSummary(period.childBirthDate, sameChild, protectionAfterBirth)
  const after = childLeaveSummary(period.childBirthDate, all, protectionAfterBirth)
  const usedDays = after.totalDays - after.remainingDays
  const monthsAfterThird = daysToMonths(daysOf(all.map(afterThirdOf).filter((span): span is Span => span !== null)))
  const hints: ParentalLeaveHint[] = []
  if (sections > PARENTAL_LEAVE_MAX_SECTIONS) hints.push('sections')
  if (after.remainingDays < 0) hints.push('total')
  if (monthsAfterThird > PARENTAL_LEAVE_MAX_MONTHS_AFTER_THIRD) hints.push('afterThird')
  const error: ParentalLeaveError | null = period.end < period.start
    ? 'end_before_start'
    : period.start < period.childBirthDate
      ? 'before_birth'
      : period.end > lastParentalLeaveDay(period.childBirthDate)
        ? 'after_eighth_birthday'
        : others.some(other => other.start <= period.end && period.start <= other.end) ? 'overlap' : null
  return {
    error, hints, sections, totalMonths: daysToMonths(usedDays), remainingMonths: daysToMonths(before.remainingDays), monthsAfterThird,
  }
}

/** The reminder „‹Name› kommt am ‹Datum› aus der Elternzeit zurück“: 4 weeks before through the day (null otherwise). */
export function returnReminderState(firstWorkingDay: IsoDate, today: IsoDate): 'upcoming' | 'today' | null {
  if (today > firstWorkingDay || today < addDays(firstWorkingDay, -PARENTAL_LEAVE_RETURN_NOTICE_DAYS)) return null
  return today === firstWorkingDay ? 'today' : 'upcoming'
}
