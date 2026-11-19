import { addDays, dateRange, daysBetween, daysInMonth, toIsoDate, weekday } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
import { weeklyMinutesOn, type EmploymentInfo } from './targets'
import type { CodeKey, IsoDate } from './types'
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

/** § 4 Abs. 1: at most 90 hours per double week, under 18 at most 80 hours. */
export const MATERNITY_MAX_DOUBLE_WEEK_MINUTES = 90 * 60
export const MATERNITY_MAX_DOUBLE_WEEK_MINUTES_UNDER_18 = 80 * 60

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
  /** The case ended on this day (e.g. the employee left): nothing applies after it, nothing is booked after it. */
  endedOn: IsoDate | null
  /** A miscarriage (Fehlgeburt) on this day ended the pregnancy (§ 3 Abs. 5 MuSchG); the birth fields no longer count. */
  miscarriageOn: IsoDate | null
  /** The week of pregnancy (SSW) of the miscarriage: from the 13th week 2, from the 17th 6, from the 20th 8 weeks of protection. */
  miscarriageWeek: number | null
  /** The employee declared she wants to work („verzichtet“): no protection period after the miscarriage. */
  miscarriageWaived: boolean
}

/** The fields the protection periods follow. */
export type PeriodFacts = Pick<MaternityFacts, 'expectedBirth' | 'actualBirth' | 'extendedAfter'>
  & Partial<Pick<MaternityFacts, 'miscarriageOn' | 'miscarriageWeek' | 'miscarriageWaived'>>

/** The fields of a ban. */
export interface BanFacts {
  employmentBan: EmploymentBanKind
  banFrom: IsoDate | null
  banTo: IsoDate | null
}

export interface DateSpan {
  from: IsoDate
  to: IsoDate
}

export interface ProtectionPeriods {
  /** The day of birth (the actual one once entered, the expected one until then), or of the miscarriage. */
  birth: IsoDate
  /** The days before the birth (null when the birth came before the period would have begun). */
  before: DateSpan | null
  /**
   * The birth day and the 8 (12) weeks after it, with the days not taken before an early birth added; after a miscarriage
   * from the 13th week its graded period (null: earlier, or the employee declined it).
   */
  after: DateSpan | null
  /** Days of the period before not taken because the birth came early (§ 3 Abs. 2 Satz 3). */
  carriedOver: number
  /** Weeks of the period after (8, 12; after a miscarriage 2, 6, 8 or 0). */
  afterWeeks: number
  /** The pregnancy ended with a miscarriage. */
  miscarriage: boolean
}

/** § 3 Abs. 5 MuSchG: days of protection after a miscarriage in this week of pregnancy (from the 13th: 2, 17th: 6, 20th: 8 weeks). */
export function miscarriageProtectionDays(week: number | null): number {
  if (week === null) return 0
  if (week >= 20) return 56
  if (week >= 17) return 42
  return week >= 13 ? 14 : 0
}

/**
 * The protection periods: before = expected birth − 42 days up to the day before the birth (running on until a late
 * birth); after = the birth day up to 8 weeks after it (birth + 56 days, § 187/188 BGB: 99 days in all with a birth on
 * the expected day), 12 weeks (birth + 84 days) when `extendedAfter`. An early birth adds the days of the period before
 * that were not taken to the end of the period after (§ 3 Abs. 2 Satz 3 MuSchG). After a miscarriage (§ 3 Abs. 5) the
 * period before ends the day before it, and the period after is its graded period from the miscarriage day (none before
 * the 13th week or when the employee declined it).
 */
export function protectionPeriods(facts: PeriodFacts): ProtectionPeriods {
  const beforeFrom = addDays(facts.expectedBirth, -MATERNITY_BEFORE_DAYS)
  if (facts.miscarriageOn) {
    const event = facts.miscarriageOn
    const beforeTo = addDays(event, -1) < addDays(facts.expectedBirth, -1) ? addDays(event, -1) : addDays(facts.expectedBirth, -1)
    const days = facts.miscarriageWaived ? 0 : miscarriageProtectionDays(facts.miscarriageWeek ?? null)
    return {
      birth: event, before: beforeTo >= beforeFrom ? { from: beforeFrom, to: beforeTo } : null,
      after: days > 0 ? { from: event, to: addDays(event, days) } : null, carriedOver: 0, afterWeeks: days / 7, miscarriage: true,
    }
  }
  const birth = facts.actualBirth ?? facts.expectedBirth
  const taken = Math.max(0, daysBetween(beforeFrom, birth))
  const carriedOver = Math.max(0, MATERNITY_BEFORE_DAYS - taken)
  const afterDays = facts.extendedAfter ? MATERNITY_AFTER_EXTENDED_DAYS : MATERNITY_AFTER_DAYS
  return {
    birth,
    before: taken > 0 ? { from: beforeFrom, to: addDays(birth, -1) } : null,
    after: { from: birth, to: addDays(birth, afterDays + carriedOver) },
    carriedOver,
    afterWeeks: facts.extendedAfter ? 12 : 8,
    miscarriage: false,
  }
}

const cutAt = (dates: IsoDate[], endedOn: IsoDate | null | undefined) => (endedOn ? dates.filter(date => date <= endedOn) : dates)

/** Every day of both protection periods, in order; none after the case's end (`endedOn`). */
export function protectionDates(facts: PeriodFacts & { endedOn?: IsoDate | null }): IsoDate[] {
  const { before, after } = protectionPeriods(facts)
  return cutAt([...(before ? dateRange(before.from, before.to) : []), ...(after ? dateRange(after.from, after.to) : [])], facts.endedOn)
}

/** The days of the period after the birth (or the miscarriage), in which no work is allowed; none after the end. */
export function protectedAfterDates(facts: PeriodFacts & { endedOn?: IsoDate | null }): IsoDate[] {
  const { after } = protectionPeriods(facts)
  return cutAt(after ? dateRange(after.from, after.to) : [], facts.endedOn)
}

/**
 * The days of a full ban (a partial one is a note on the case plus shorter duties), from its first day to its end;
 * without an end until the day before the protection period before the birth (a ban during the pregnancy) or, after
 * the birth, until the end of the breastfeeding time. Never on days of the protection periods (Mutterschutz comes
 * first), never after the case's end. Empty when there is no such period.
 */
export function banDates(facts: PeriodFacts & BanFacts & { breastfeedingUntil: IsoDate | null; endedOn?: IsoDate | null }): IsoDate[] {
  if (facts.employmentBan !== 'full' || facts.banFrom === null) return []
  const { before, birth } = protectionPeriods(facts)
  const to = facts.banTo ?? (facts.banFrom < birth ? addDays(before?.from ?? birth, -1) : facts.breastfeedingUntil)
  if (to === null || to < facts.banFrom) return []
  const protectedDays = new Set(protectionDates(facts))
  return cutAt(dateRange(facts.banFrom, to).filter(date => !protectedDays.has(date)), facts.endedOn)
}

/**
 * The last day the hints apply: the end of the period after the birth, or the end of the breastfeeding time if later;
 * after a miscarriage the end of its period (without one: the day of the miscarriage); cut by the end.
 */
export function maternityLastDay(facts: MaternityFacts): IsoDate {
  const { after, birth, miscarriage } = protectionPeriods(facts)
  const protectedTo = after?.to ?? (miscarriage ? addDays(birth, -1) : birth)
  const last = !miscarriage && facts.breastfeedingUntil !== null && facts.breastfeedingUntil > protectedTo ? facts.breastfeedingUntil : protectedTo
  return facts.endedOn !== null && facts.endedOn < last ? facts.endedOn : last
}

/** Whether the rules of the case apply on the day: from the notice to its last day (maternityLastDay). */
export function maternityOpenOn(facts: MaternityFacts, date: IsoDate): boolean {
  return date >= facts.notifiedOn && date <= maternityLastDay(facts)
}

/** Before the birth, in the protection period after it (or after a miscarriage: no work allowed), or later (breastfeeding). */
export type MaternityPhase = 'pregnancy' | 'after' | 'breastfeeding'

export function maternityPhaseOn(facts: PeriodFacts, date: IsoDate): MaternityPhase {
  const { birth, after } = protectionPeriods(facts)
  if (after && date >= after.from && date <= after.to) return 'after'
  return date < birth ? 'pregnancy' : 'breastfeeding'
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

export type MaternityRule = 'hours' | 'late' | 'early' | 'sunday' | 'rest' | 'average' | 'doubleWeek' | 'protected' | 'ban'
export const MATERNITY_RULES: readonly MaternityRule[] = ['hours', 'late', 'early', 'sunday', 'rest', 'average', 'doubleWeek', 'protected', 'ban']

/**
 * A hint of the case. `value` and `limit` by rule: hours = minutes worked and the daily maximum; late = the end of the
 * work and 20:00; early = its start and 6:00; sunday = minutes worked and 0; rest = the rest in minutes and 11 h;
 * average = the average weekly minutes of the month and the contractual weekly minutes; doubleWeek = the minutes of the
 * double week and 90 h (80 h under 18); protected (work in the period after the birth or a miscarriage) and ban (work on
 * a day of a full employment ban) = minutes worked and 0.
 */
export interface MaternityWarning {
  type: 'maternity'
  date: IsoDate
  employeeId: number
  rule: MaternityRule
  value: number
  limit: number
  phase: MaternityPhase
  /** „protected“ after a miscarriage (§ 3 Abs. 5) rather than a birth. */
  miscarriage?: true
}

/**
 * The hints of one day on which the case applies, from the planned entries (working time as the ArbZG hints count it:
 * workingTimeLaw.ts). In the period after the birth (or a miscarriage) any work is one hint „protected“ (§ 3 Abs. 2:
 * no employment at all), on a day of a full ban one hint „ban“. Otherwise: more than 8:30 h (8:00 h under 18), work
 * after 20:00 or before 6:00, work on a Sunday or a public holiday of the home facility, less than 11 h of rest after the
 * day before.
 */
export function maternityDayWarnings(input: {
  date: IsoDate; employeeId: number; phase: MaternityPhase; under18: boolean; entries: LawEntry[]; previousEntries: LawEntry[]
  holidays: HolidayRules; banned?: boolean; miscarriage?: boolean
}): MaternityWarning[] {
  const { date, employeeId, phase } = input
  const warning = (rule: MaternityRule, value: number, limit: number): MaternityWarning =>
    ({ type: 'maternity', date, employeeId, rule, value, limit, phase })
  const window = plannedWorkWindow(input.entries)
  if (window === null) return []
  const minutes = plannedWorkMinutes(input.entries)
  if (phase === 'after') return [{ ...warning('protected', minutes, 0), ...(input.miscarriage ? { miscarriage: true as const } : {}) }]
  if (input.banned) return [warning('ban', minutes, 0)]
  const warnings: MaternityWarning[] = []
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
 * § 4 Abs. 1: at most 90 hours per double week (80 hours under 18). Every double week starting on a Monday whose last
 * day of the case lies between `from` and `to` (the month) is checked over its days of the case (`caseDays`, which must
 * include the 13 days before `from`); the hint stands on that last day.
 */
export function maternityDoubleWeekWarnings(input: {
  employeeId: number; caseDays: readonly IsoDate[]; from: IsoDate; to: IsoDate; entriesOf: (date: IsoDate) => LawEntry[]
  under18On: (date: IsoDate) => boolean; phaseOf: (date: IsoDate) => MaternityPhase
}): MaternityWarning[] {
  const days = new Set(input.caseDays)
  const warnings: MaternityWarning[] = []
  // Mondays from the one 13 days before the month at the latest.
  let monday = addDays(input.from, -13)
  monday = addDays(monday, (7 - weekday(monday)) % 7)
  for (; monday <= input.to; monday = addDays(monday, 7)) {
    const window = dateRange(monday, addDays(monday, 13)).filter(date => days.has(date))
    const last = window.at(-1)
    if (last === undefined || last < input.from || last > input.to) continue
    const minutes = window.reduce((sum, date) => sum + plannedWorkMinutes(input.entriesOf(date)), 0)
    const limit = input.under18On(last) ? MATERNITY_MAX_DOUBLE_WEEK_MINUTES_UNDER_18 : MATERNITY_MAX_DOUBLE_WEEK_MINUTES
    if (minutes > limit) {
      warnings.push({ type: 'maternity', date: last, employeeId: input.employeeId, rule: 'doubleWeek', value: minutes, limit, phase: input.phaseOf(last) })
    }
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

// ---- hiding the reason -----------------------------------------------------------

/** The codes that tell a pregnancy: shown as „abwesend“ to everybody who may not see the case, and always at the tablet. */
export const PROTECTED_CODE_KEYS: readonly CodeKey[] = [MATERNITY_CODE, EMPLOYMENT_BAN_CODE]
/** The neutral face of such an entry (the server cannot read app/locales/de.ts, so the words live here). */
export const MASKED_ABSENCE = { label: 'abwesend', shortLabel: null, color: 'gray' } as const

export function isProtectedCode(codeKey: CodeKey | null | undefined): boolean {
  return !!codeKey && PROTECTED_CODE_KEYS.includes(codeKey)
}

/**
 * An entry of a protected code as a neutral absence: label „abwesend“, grey, without code key, code id and note, so
 * nothing in the data tells the reason; it still credits the daily target (whole day). Other entries stay as they are.
 */
export function maskProtectedEntry<T extends {
  kind: string; codeKey: CodeKey | null; codeId: number | null; label: string; shortLabel: string | null; color: string; note?: string | null
}>(entry: T): T {
  if (entry.kind !== 'code' || !isProtectedCode(entry.codeKey)) return entry
  return {
    ...entry, codeKey: null, codeId: null, label: MASKED_ABSENCE.label, shortLabel: MASKED_ABSENCE.shortLabel,
    color: MASKED_ABSENCE.color, note: null,
  }
}
