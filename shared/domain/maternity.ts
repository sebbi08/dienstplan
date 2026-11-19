import { addDays, dateRange, daysBetween, daysInMonth, toIsoDate, weekday } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
import { weeklyMinutesOn, type EmploymentInfo } from './targets'
import type { IsoDate } from './types'
import { plannedWorkMinutes, plannedWorkWindow, restMinutes, type LawEntry } from './workingTimeLaw'

/**
 * Mutterschutz (MuSchG): the protection periods (§ 3), and the plan hints on working time (§ 4 hours and rest, § 5
 * night work, § 6 Sundays and public holidays) for an employee with a case. Pure rules shared by the server (booking,
 * hints, reminders) and the employee page. Pregnancy is health data: only whoever may see the case (employees.sickness)
 * gets the hints with their reason (server/services/maternity.ts).
 */

/** The period before the birth: six weeks before the expected day of birth (§ 3 Abs. 1). */
export const MATERNITY_BEFORE_DAYS = 42
/** After the birth: eight weeks after the birth day (§ 3 Abs. 2), twelve after a premature or multiple birth or a disabled child. */
export const MATERNITY_AFTER_DAYS = 56
export const MATERNITY_AFTER_EXTENDED_DAYS = 84

/** § 4 Abs. 1: at most 8:30 h of work a day, under 18 at most 8:00 h. */
export const MATERNITY_MAX_DAILY_MINUTES = 8 * 60 + 30
export const MATERNITY_MAX_DAILY_MINUTES_UNDER_18 = 8 * 60
/** § 5 Abs. 1: no work between 20:00 and 6:00. */
export const MATERNITY_NIGHT_FROM = 20 * 60
export const MATERNITY_NIGHT_UNTIL = 6 * 60
/** § 4 Abs. 2: at least 11 hours of rest after the end of the daily work. */
export const MATERNITY_MIN_REST_MINUTES = 11 * 60

export const EMPLOYMENT_BAN_KINDS = ['none', 'partial', 'full'] as const
export type EmploymentBanKind = typeof EMPLOYMENT_BAN_KINDS[number]
export const MATERNITY_NOTE_MAX = 2000

/** The codes the case books into the plan: whole days, neutral for the hours account, no presence, no leave. */
export const MATERNITY_CODE = 'maternity'
export const EMPLOYMENT_BAN_CODE = 'employment_ban'

/** What the periods and hints need of a case. */
export interface MaternityFacts {
  /** The day the employer learnt of the pregnancy (Bekanntgabe): the hints start here. */
  notifiedOn: IsoDate
  expectedBirth: IsoDate
  actualBirth: IsoDate | null
  /** Premature or multiple birth or a disabled child: 12 weeks after the birth. */
  extendedAfter: boolean
  /** Stillzeit: the hints go on until this day (null = none entered). */
  breastfeedingUntil: IsoDate | null
  /** The case ended on this day (e.g. the employee left, or the pregnancy ended early): nothing applies after it. */
  endedOn: IsoDate | null
}

export interface DateSpan {
  from: IsoDate
  to: IsoDate
}

export interface ProtectionPeriods {
  /** The day of birth: the actual one once entered, the expected one until then. */
  birth: IsoDate
  /** The days before the birth (null when the birth came before the period would have begun). */
  before: DateSpan | null
  /** The birth day and the 8 (12) weeks after it, with the days not taken before an early birth added. */
  after: DateSpan
  /** Days of the period before not taken because the birth came early (§ 3 Abs. 2 Satz 3). */
  carriedOver: number
  afterWeeks: 8 | 12
}

/**
 * The protection periods: before = expected birth − 42 days up to the day before the birth (running on until a late
 * birth); after = the birth day up to 8 weeks after it (birth + 56 days, § 187/188 BGB: 99 days in all with a birth on
 * the expected day), 12 weeks (birth + 84 days) when `extendedAfter`. An early birth adds the days of the period before
 * that were not taken to the end of the period after (§ 3 Abs. 2 Satz 3 MuSchG).
 */
export function protectionPeriods(facts: Pick<MaternityFacts, 'expectedBirth' | 'actualBirth' | 'extendedAfter'>): ProtectionPeriods {
  const birth = facts.actualBirth ?? facts.expectedBirth
  const beforeFrom = addDays(facts.expectedBirth, -MATERNITY_BEFORE_DAYS)
  const taken = Math.max(0, daysBetween(beforeFrom, birth))
  const carriedOver = Math.max(0, MATERNITY_BEFORE_DAYS - taken)
  const afterDays = facts.extendedAfter ? MATERNITY_AFTER_EXTENDED_DAYS : MATERNITY_AFTER_DAYS
  return {
    birth,
    before: taken > 0 ? { from: beforeFrom, to: addDays(birth, -1) } : null,
    after: { from: birth, to: addDays(birth, afterDays + carriedOver) },
    carriedOver,
    afterWeeks: facts.extendedAfter ? 12 : 8,
  }
}

/** Every day of both protection periods, in order. */
export function protectionDates(facts: Pick<MaternityFacts, 'expectedBirth' | 'actualBirth' | 'extendedAfter'>): IsoDate[] {
  const { before, after } = protectionPeriods(facts)
  return [...(before ? dateRange(before.from, before.to) : []), ...dateRange(after.from, after.to)]
}

/** The last day the hints apply: the end of the period after the birth, or the end of the breastfeeding time if later; cut by the end. */
export function maternityLastDay(facts: MaternityFacts): IsoDate {
  const { after } = protectionPeriods(facts)
  const last = facts.breastfeedingUntil !== null && facts.breastfeedingUntil > after.to ? facts.breastfeedingUntil : after.to
  return facts.endedOn !== null && facts.endedOn < last ? facts.endedOn : last
}

/** Whether the rules of the case apply on the day: from the notice to its last day (maternityLastDay). */
export function maternityOpenOn(facts: MaternityFacts, date: IsoDate): boolean {
  return date >= facts.notifiedOn && date <= maternityLastDay(facts)
}

export type MaternityPhase = 'pregnancy' | 'after' | 'breastfeeding'

/** Before the birth (the actual one, else the expected one), in the period after it, or later (breastfeeding). */
export function maternityPhaseOn(facts: MaternityFacts, date: IsoDate): MaternityPhase {
  const { birth, after } = protectionPeriods(facts)
  if (date < birth) return 'pregnancy'
  return date <= after.to ? 'after' : 'breastfeeding'
}

/** Under 18 on the day, from the birthday (`MM-DD`) and the birth year; false when either is missing. */
export function isUnder18On(birthday: string | null, birthYear: number | null, date: IsoDate): boolean {
  if (birthday === null || birthYear === null) return false
  const [month, day] = birthday.split('-').map(Number) as [number, number]
  const year = birthYear + 18
  // Born on 29 February: the year is complete at the end of 28 February, so 18 from 1 March in a common year.
  const eighteenth = day > daysInMonth(year, month) ? addDays(toIsoDate(year, month, daysInMonth(year, month)), 1) : toIsoDate(year, month, day)
  return date < eighteenth
}

export type MaternityRule = 'hours' | 'late' | 'early' | 'sunday' | 'rest' | 'average'
export const MATERNITY_RULES: readonly MaternityRule[] = ['hours', 'late', 'early', 'sunday', 'rest', 'average']

/**
 * A hint of the case. `value` and `limit` by rule: hours = minutes worked and the daily maximum; late = the end of the
 * work and 20:00; early = its start and 6:00; sunday = minutes worked and 0; rest = the rest in minutes and 11 h;
 * average = the average weekly minutes of the month and the contractual weekly minutes.
 */
export interface MaternityWarning {
  type: 'maternity'
  date: IsoDate
  employeeId: number
  rule: MaternityRule
  value: number
  limit: number
  phase: MaternityPhase
}

/**
 * The hints of one day on which the case applies, from the planned entries (working time as the ArbZG hints count it:
 * workingTimeLaw.ts): more than 8:30 h (8:00 h under 18), work after 20:00 or before 6:00, work on a Sunday or a public
 * holiday of the home facility, less than 11 h of rest after the day before.
 */
export function maternityDayWarnings(input: {
  date: IsoDate; employeeId: number; phase: MaternityPhase; under18: boolean; entries: LawEntry[]; previousEntries: LawEntry[]
  holidays: HolidayRules
}): MaternityWarning[] {
  const { date, employeeId, phase } = input
  const warning = (rule: MaternityRule, value: number, limit: number): MaternityWarning =>
    ({ type: 'maternity', date, employeeId, rule, value, limit, phase })
  const window = plannedWorkWindow(input.entries)
  if (window === null) return []
  const warnings: MaternityWarning[] = []
  const minutes = plannedWorkMinutes(input.entries)
  const max = input.under18 ? MATERNITY_MAX_DAILY_MINUTES_UNDER_18 : MATERNITY_MAX_DAILY_MINUTES
  if (minutes > max) warnings.push(warning('hours', minutes, max))
  if (window.end > MATERNITY_NIGHT_FROM) warnings.push(warning('late', window.end, MATERNITY_NIGHT_FROM))
  if (window.start < MATERNITY_NIGHT_UNTIL) warnings.push(warning('early', window.start, MATERNITY_NIGHT_UNTIL))
  if (weekday(date) === 6 || isHolidayIn(date, input.holidays)) warnings.push(warning('sunday', minutes, 0))
  const previous = plannedWorkWindow(input.previousEntries)
  if (previous !== null) {
    const rest = restMinutes(previous.end, window.start)
    if (rest < MATERNITY_MIN_REST_MINUTES) warnings.push(warning('rest', rest, MATERNITY_MIN_REST_MINUTES))
  }
  return warnings
}

/**
 * § 4 Abs. 1 Satz 4: the work may not exceed the contractual weekly hours in the monthly average. `dates` are the days
 * of one calendar month on which the case applies and the person is employed; the work of these days (planned, as the
 * day hints count it) is compared with the contractual hours of the same days (the weekly hours valid on each day / 7).
 * The hint (on the last of the days) shows both as weekly averages.
 */
export function maternityMonthWarning(input: {
  employeeId: number; dates: IsoDate[]; info: EmploymentInfo; entriesOf: (date: IsoDate) => LawEntry[]; phase: MaternityPhase
}): MaternityWarning | null {
  if (input.dates.length === 0) return null
  let work = 0
  let contract = 0
  for (const date of input.dates) {
    work += plannedWorkMinutes(input.entriesOf(date))
    contract += (weeklyMinutesOn(input.info, date) ?? 0) / 7
  }
  if (work <= Math.round(contract)) return null
  const days = input.dates.length
  return {
    type: 'maternity', date: input.dates.at(-1)!, employeeId: input.employeeId, rule: 'average',
    value: Math.round(work * 7 / days), limit: Math.round(contract * 7 / days), phase: input.phase,
  }
}
