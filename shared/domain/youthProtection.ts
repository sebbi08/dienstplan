import { addDays, dateRange, weekday, weekStart } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
import { addMonths, REQUIREMENT_SOON_MONTHS, type RequirementState, type YouthExamKey } from './requirements'
import type { Qualification } from './staffing/types'
import { leaveBasis, leaveInYear, type StatutoryLeave } from './statutoryLeave'
import { weeklyMinutesOn, workdayCount, workdaysOn, type EmploymentInfo, type HoursPeriod } from './targets'
import type { IsoDate, Minutes } from './types'
import { plannedWorkMinutes, plannedWorkSpans, plannedWorkWindow, restMinutes, type LawEntry, type WorkWindow } from './workingTimeLaw'

/**
 * Jugendarbeitsschutz (JArbSchG) for employees under 18: the plan hints on working time (§§ 8, 9, 11, 13–18), the
 * minimum leave (§ 19) and the medical examinations (§§ 32, 33). Only hints, nothing is blocked. Age is no health data:
 * the hints show to every plan editor like the ArbZG hints, but never state the birth date.
 *
 * Working time is what the ArbZG hints count (workingTimeLaw.ts): work entries without breaks and time off, plus
 * Fortbildung with times, plus Schule with times including its breaks (§ 9 Abs. 2 Nr. 2). Breaks are the planned ones (breaks of the entries, additional breaks, gaps between
 * entries): § 11 Abs. 2 wants them fixed in advance, so the automatic break deduction of the time tracking does not count.
 */

/** § 8 Abs. 1: at most 8 hours a day and 40 hours a week. */
export const YOUTH_MAX_DAILY_MINUTES = 8 * 60
/** § 8 Abs. 2a: 8:30 h on the other workdays of a week in which single workdays are shorter than 8 hours. */
export const YOUTH_MAX_DAILY_MINUTES_EXTENDED = 8 * 60 + 30
export const YOUTH_MAX_WEEKLY_MINUTES = 40 * 60
/** § 15: at most five days a week. */
export const YOUTH_MAX_DAYS_PER_WEEK = 5
/** § 14: only between 6:00 and 20:00. */
export const YOUTH_EARLIEST: Minutes = 6 * 60
export const YOUTH_LATEST: Minutes = 20 * 60
/** § 13: at least 12 hours of free time after the end of the daily work. */
export const YOUTH_MIN_REST_MINUTES = 12 * 60
/** § 11: only interruptions of at least 15 minutes are breaks; at most 4:30 h of work without one. */
export const YOUTH_BREAK_MIN_BLOCK = 15
export const YOUTH_MAX_STRETCH_MINUTES = 4 * 60 + 30
/**
 * § 9 Abs. 1 Nr. 2: a school day with more than five lessons of at least 45 minutes, so at least 6 × 45 minutes of
 * lessons (the times of the „Schule“ entries without their breaks), or a „Schule“ day without times at all.
 */
export const SCHOOL_LONG_DAY_MINUTES = 6 * 45
/**
 * § 9 Abs. 2 Nr. 1: such a day counts with the average daily working time (contractual weekly hours ÷ working days per
 * week); 8 hours when that is unknown.
 */
export const SCHOOL_LONG_DAY_CREDIT_FALLBACK = 8 * 60
/** § 9 Abs. 1 Nr. 1: no work before lessons that start before 9:00. */
export const SCHOOL_EARLY_START: Minutes = 9 * 60
/** § 18 Abs. 1: no work on 24 and 31 December after 14:00. */
export const YOUTH_EVE_END: Minutes = 14 * 60

// ---- age ---------------------------------------------------------------------

/**
 * Completed years on the day from the birthday (`MM-DD`) and the birth year; null when either is missing. The birthday
 * itself counts (§ 187 Abs. 2 BGB); born on 29 February, the year is complete with 28 February in a common year, so the
 * new age counts from 1 March.
 */
export function ageOn(birthday: string | null, birthYear: number | null, date: IsoDate): number | null {
  if (birthday === null || birthYear === null) return null
  const years = Number(date.slice(0, 4)) - birthYear
  return date.slice(5) < birthday ? years - 1 : years
}

/**
 * Whether the person is under 18 on the day: from the full birth date; with the birth year alone certain while the
 * year of the day is at most 17 years after it ('minor') or at least 19 ('adult'), unknown in the year of the 18th
 * birthday; unknown without a birth year.
 */
export function minorStatusOn(birthday: string | null, birthYear: number | null, date: IsoDate): 'minor' | 'adult' | 'unknown' {
  if (birthYear === null) return 'unknown'
  const age = ageOn(birthday, birthYear, date)
  if (age !== null) return age < 18 ? 'minor' : 'adult'
  const years = Number(date.slice(0, 4)) - birthYear
  return years <= 17 ? 'minor' : years >= 19 ? 'adult' : 'unknown'
}

/** Certainly under 18 on the day (minorStatusOn): the rules apply. */
export function isMinorOn(birthday: string | null, birthYear: number | null, date: IsoDate): boolean {
  return minorStatusOn(birthday, birthYear, date) === 'minor'
}

/**
 * A birth year without a birthday in the year of the 18th birthday: whether the person is still under 18 cannot be told,
 * so the Leitung gets „Geburtstag fehlt – Jugendarbeitsschutz kann nicht sicher geprüft werden“.
 */
export function birthdayUncertainOn(birthday: string | null, birthYear: number | null, date: IsoDate): boolean {
  return birthYear !== null && minorStatusOn(birthday, birthYear, date) === 'unknown'
}

/**
 * Qualifications of whoever may well be under 18 (Auszubildende, Studierende, Praktikanten, „keine pädagogische Kraft“):
 * without a birth year the Leitung gets the hint „Geburtsjahr fehlt“.
 */
export function needsBirthYear(qualification: Qualification | null): boolean {
  return qualification !== null
    && (qualification.startsWith('azubi_') || qualification.startsWith('studium_') || qualification === 'praktikant' || qualification === 'none')
}

// ---- plan hints --------------------------------------------------------------

export type YouthRule =
  | 'hours' | 'week' | 'days' | 'early' | 'late' | 'saturday' | 'sunday' | 'holiday' | 'rest' | 'break' | 'stretch'
  | 'schoolDay' | 'schoolBefore' | 'eve'
export const YOUTH_RULES: readonly YouthRule[] = [
  'hours', 'week', 'days', 'early', 'late', 'saturday', 'sunday', 'holiday', 'rest', 'break', 'stretch', 'schoolDay', 'schoolBefore',
  'eve',
]

/**
 * A hint of the Jugendarbeitsschutz. `value` and `limit` by rule: hours = working minutes (school included) and 8:00 h
 * (8:30 h, § 8 Abs. 2a); week = the minutes of the calendar week (school included) and 40 h, on the day the week passes
 * them; days = workdays of the week and 5, on the sixth; early = the start of the work and 6:00; late = its end and
 * 20:00; saturday, sunday, holiday = minutes worked and 0; eve = the end of the work on 24 or 31 December and 14:00;
 * rest = the free time since the day before and 12 h; break = the breaks that count and the 30 or 60 minutes needed;
 * stretch = the longest work without a break and 4:30 h; schoolDay = minutes worked besides school on the first long
 * school day of a week in which no long school day is free, and 0; schoolBefore = the start of the work and the start of
 * the lessons (before 9:00). Work in § 14 and §§ 16–18 is the work besides school (school is no employment).
 */
export interface YouthWarning {
  type: 'youth'
  date: IsoDate
  employeeId: number
  rule: YouthRule
  value: number
  limit: number
}

const isSchool = (entry: LawEntry) => entry.kind === 'code' && entry.codeKey === 'school'

interface SchoolFacts {
  /** The first lesson (null: school without times). */
  start: Minutes | null
  /** More than five lessons (or no times): one such day a week free of work, credited for the week (§ 9 Abs. 2). */
  long: boolean
  untimed: boolean
}

interface DayFacts {
  date: IsoDate
  /** Working time of the day: the work, and timed school with its breaks (§ 9 Abs. 2 Nr. 2); its first and last minute. */
  minutes: number
  window: WorkWindow | null
  /** The work besides school: minutes, first and last minute, spans (the breaks lie between them). */
  workMinutes: number
  workWindow: WorkWindow | null
  workSpans: WorkWindow[]
  school: SchoolFacts | null
}

function schoolFacts(entries: LawEntry[]): SchoolFacts | null {
  const school = entries.filter(isSchool)
  if (school.length === 0) return null
  const timed = school.filter(entry => entry.start !== null && entry.end !== null)
  if (timed.length === 0) return { start: null, long: true, untimed: true }
  const lessons = timed.reduce((sum, entry) => {
    const pause = entry.breakStart !== null && entry.breakEnd !== null ? entry.breakEnd - entry.breakStart : 0
    return sum + entry.end! - entry.start! - pause
  }, 0)
  return { start: Math.min(...timed.map(entry => entry.start!)), long: lessons >= SCHOOL_LONG_DAY_MINUTES, untimed: false }
}

const DAY_MINUTES = 24 * 60

function dayFacts(date: IsoDate, entries: LawEntry[]): DayFacts {
  const work = entries.filter(entry => !isSchool(entry))
  const workSpans = plannedWorkSpans(work)
  // The work and the timed school with its breaks, overlaps once.
  const all = new Uint8Array(DAY_MINUTES)
  for (const span of workSpans) all.fill(1, span.start, span.end)
  for (const entry of entries) if (isSchool(entry) && entry.start !== null && entry.end !== null) all.fill(1, entry.start, entry.end)
  const first = all.indexOf(1)
  return {
    date, minutes: all.reduce((sum, minute) => sum + minute, 0), window: first === -1 ? null : { start: first, end: all.lastIndexOf(1) + 1 },
    workMinutes: plannedWorkMinutes(work), workWindow: plannedWorkWindow(work), workSpans, school: schoolFacts(entries),
  }
}

/** § 11: the breaks that count (interruptions of at least 15 minutes) and the longest work without one. */
function breakFacts(spans: WorkWindow[]): { breaks: number; longest: number } {
  let breaks = 0
  let longest = 0
  let blockStart: Minutes | null = null
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]!
    const gap = index === 0 ? null : span.start - spans[index - 1]!.end
    if (gap === null || gap >= YOUTH_BREAK_MIN_BLOCK) {
      if (gap !== null) breaks += gap
      blockStart = span.start
    }
    longest = Math.max(longest, span.end - blockStart!)
  }
  return { breaks, longest }
}

/** § 11 Abs. 1: 30 minutes for more than 4:30 h of work, 60 minutes for more than 6 h. */
export function youthRequiredBreak(minutes: number): number {
  return minutes > 6 * 60 ? 60 : minutes > YOUTH_MAX_STRETCH_MINUTES ? 30 : 0
}

/**
 * § 9 Abs. 2 Nr. 1: the average daily working time from the contract (weekly minutes ÷ working days per week valid on
 * the day); 8 hours without weekly hours.
 */
export function averageDailyMinutes(info: EmploymentInfo, date: IsoDate): number {
  const weekly = weeklyMinutesOn(info, date)
  const days = workdayCount(workdaysOn(info, date))
  return weekly === null || days === 0 ? SCHOOL_LONG_DAY_CREDIT_FALLBACK : Math.round(weekly / days)
}

/**
 * The hints of one person from `from` to `to` (both included), from the planned entries of each day (`entriesOf`, also
 * for the day before `from` and for the whole calendar weeks around the range). `appliesOn` tells the days the rules
 * apply on: under 18 and employed; the week rules count only these days. `creditOn` is what a long school day counts for
 * the week (averageDailyMinutes; 8 hours when missing).
 */
export function youthWarnings(input: {
  employeeId: number; from: IsoDate; to: IsoDate; holidays: HolidayRules
  entriesOf: (date: IsoDate) => LawEntry[]; appliesOn: (date: IsoDate) => boolean; creditOn?: (date: IsoDate) => number
}): YouthWarning[] {
  const warnings: YouthWarning[] = []
  const creditOn = input.creditOn ?? (() => SCHOOL_LONG_DAY_CREDIT_FALLBACK)
  for (let monday = weekStart(input.from); monday <= input.to; monday = addDays(monday, 7)) {
    const days = dateRange(monday, addDays(monday, 6)).filter(input.appliesOn).map(date => dayFacts(date, input.entriesOf(date)))
    // § 9 Abs. 1 Nr. 2: one long school day a week must be free of work; that one (else the first) is credited with the
    // average daily working time (§ 9 Abs. 2 Nr. 1). Other school days count their lessons with breaks; a long one
    // without times, whose lessons are unknown, counts the credit as well.
    const longDays = days.filter(day => day.school?.long)
    const freeLong = longDays.find(day => day.workWindow === null) ?? null
    const credited = (freeLong ?? longDays[0])?.date ?? null
    const counted = new Map(days.map(day => [
      day.date,
      day.date === credited || day.school?.untimed ? Math.max(creditOn(day.date), day.minutes) : day.minutes,
    ]))
    const weekTotal = days.reduce((sum, day) => sum + counted.get(day.date)!, 0)
    const isWorkday = (day: DayFacts) => counted.get(day.date)! > 0 || day.school !== null
    const workdays = days.filter(isWorkday).length
    let running = 0
    let workdaysSoFar = 0
    for (const day of days) {
      const { date } = day
      const inRange = date >= input.from && date <= input.to
      const warn = (rule: YouthRule, value: number, limit: number) => {
        if (inRange) warnings.push({ type: 'youth', date, employeeId: input.employeeId, rule, value, limit })
      }
      // § 8 Abs. 1, 2a: 8 hours; 8:30 h when another Werktag (Monday to Saturday) of the week is shorter than 8 hours.
      if (day.minutes > YOUTH_MAX_DAILY_MINUTES) {
        const shortened = days.some(other => other.date !== date && weekday(other.date) <= 5
          && counted.get(other.date)! > 0 && counted.get(other.date)! < YOUTH_MAX_DAILY_MINUTES)
        const limit = shortened ? YOUTH_MAX_DAILY_MINUTES_EXTENDED : YOUTH_MAX_DAILY_MINUTES
        if (day.minutes > limit) warn('hours', day.minutes, limit)
      }
      if (day.workWindow !== null) {
        // § 14: from 6 to 20 o'clock (school is no employment).
        if (day.workWindow.start < YOUTH_EARLIEST) warn('early', day.workWindow.start, YOUTH_EARLIEST)
        if (day.workWindow.end > YOUTH_LATEST) warn('late', day.workWindow.end, YOUTH_LATEST)
        // §§ 16–18: no work on Saturdays, Sundays and public holidays of the home facility (exceptions exist: only a
        // hint), none after 14:00 on 24 and 31 December.
        if (isHolidayIn(date, input.holidays)) warn('holiday', day.workMinutes, 0)
        else if (weekday(date) === 6) warn('sunday', day.workMinutes, 0)
        else if (weekday(date) === 5) warn('saturday', day.workMinutes, 0)
        if ((date.endsWith('-12-24') || date.endsWith('-12-31')) && day.workWindow.end > YOUTH_EVE_END) {
          warn('eve', day.workWindow.end, YOUTH_EVE_END)
        }
      }
      if (day.window !== null) {
        // § 13: 12 hours of free time after the work (and school) of the day before.
        const previous = dayFacts(addDays(date, -1), input.entriesOf(addDays(date, -1))).window
        if (previous !== null) {
          const rest = restMinutes(previous.end, day.window.start)
          if (rest < YOUTH_MIN_REST_MINUTES) warn('rest', rest, YOUTH_MIN_REST_MINUTES)
        }
      }
      // § 11: breaks of the work besides school (lessons have the school's breaks).
      const { breaks, longest } = breakFacts(day.workSpans)
      const required = youthRequiredBreak(day.workMinutes)
      if (breaks < required) warn('break', breaks, required)
      if (longest > YOUTH_MAX_STRETCH_MINUTES) warn('stretch', longest, YOUTH_MAX_STRETCH_MINUTES)
      // § 9 Abs. 1: one long school day a week free of work (the hint on the first when none is), no work before lessons
      // starting before 9:00.
      if (day.school !== null && day.workWindow !== null) {
        if (freeLong === null && date === longDays[0]?.date) warn('schoolDay', day.workMinutes, 0)
        else if (day.school.start !== null && day.school.start < SCHOOL_EARLY_START && day.workWindow.start < day.school.start) {
          warn('schoolBefore', day.workWindow.start, day.school.start)
        }
      }
      // § 8 Abs. 1: 40 hours a week (school counts, § 9 Abs. 2), on the day the week passes them.
      const minutes = counted.get(date)!
      running += minutes
      if (running > YOUTH_MAX_WEEKLY_MINUTES && running - minutes <= YOUTH_MAX_WEEKLY_MINUTES) warn('week', weekTotal, YOUTH_MAX_WEEKLY_MINUTES)
      // § 15: five days a week, on the sixth.
      if (isWorkday(day) && ++workdaysSoFar === YOUTH_MAX_DAYS_PER_WEEK + 1) warn('days', workdays, YOUTH_MAX_DAYS_PER_WEEK)
    }
  }
  return warnings
}

// ---- leave -------------------------------------------------------------------

/** § 19 Abs. 2: Werktage (6-day week) by the age at the start of the year: under 16 30, under 17 27, under 18 25; else null. */
export function youthLeaveWerktage(ageAtYearStart: number): number | null {
  if (ageAtYearStart < 16) return 30
  if (ageAtYearStart < 17) return 27
  return ageAtYearStart < 18 ? 25 : null
}

/** Up to the next half day (20,83 → 21; 22,5 stays). */
const upToHalf = (days: number) => Math.ceil(Math.round(days * 2 * 1e6) / 1e6) / 2

/**
 * The minimum leave for Jugendliche (§ 19 JArbSchG), only a hint: the Werktage by the age on 1 January of the year,
 * converted to the working days per week (days × workdays / 6, up to half days), in a year of joining or leaving the
 * twelfths of the BUrlG (§ 19 Abs. 4). Without a birthday the year alone tells when the person is certainly under 18 on
 * 1 January (minorStatusOn); the age is then taken as year − birth year − 1 (born on 1 January, one year more). null when
 * the person is (or may be) 18 at the start of the year, or without a birth year.
 */
export function youthMinimumLeave(input: {
  birthday: string | null; birthYear: number | null; year: number; workdaysPerWeek: number; employedFrom: IsoDate | null
  employedUntil?: IsoDate | null
}): StatutoryLeave | null {
  const yearStart: IsoDate = `${input.year}-01-01`
  if (!isMinorOn(input.birthday, input.birthYear, yearStart)) return null
  const age = ageOn(input.birthday, input.birthYear, yearStart) ?? input.year - input.birthYear! - 1
  const werktage = youthLeaveWerktage(age)
  if (werktage === null) return null
  const perYear = upToHalf((werktage * input.workdaysPerWeek) / 6)
  return { perYear, inYear: leaveInYear(perYear, input) }
}

/** The same for an employee from the weekly-hours history, as the statutory hint reads it (statutoryLeaveOf). */
export function youthLeaveOf(
  employee: { hours: HoursPeriod[]; leftOn: IsoDate | null }, year: number, birthday: string | null, birthYear: number | null,
): StatutoryLeave | null {
  return youthMinimumLeave({ ...leaveBasis(employee, year), year, employedUntil: employee.leftOn, birthday, birthYear })
}

// ---- examinations ------------------------------------------------------------

/**
 * The state of an examination kind for an employee (null = not shown): the first examination (§ 32) is due by the start
 * of employment, the follow-up (§ 33) one year after it. A kind applies when the person is under 18 on that day and still
 * today (after the 18th birthday nothing is to be done any more); a kind with a record always shows, as „in Ordnung“.
 * „bald fällig“ two months before the first examination; for the follow-up from nine months after the start, when the
 * employer has to remind the person of it (§ 33 Abs. 1 Satz 2).
 */
export function youthExamStatus(
  key: YouthExamKey, facts: { birthday: string | null; birthYear: number | null; start: IsoDate | null },
  lastDate: IsoDate | null, today: IsoDate,
): { state: RequirementState; dueOn: IsoDate | null } | null {
  if (lastDate !== null) return { state: 'ok', dueOn: null }
  if (facts.start === null) return null
  const dueOn = key === 'youth_initial' ? facts.start : addMonths(facts.start, 12)
  if (!isMinorOn(facts.birthday, facts.birthYear, dueOn) || !isMinorOn(facts.birthday, facts.birthYear, today)) return null
  if (dueOn <= today) return { state: 'overdue', dueOn }
  const soonFrom = key === 'youth_initial' ? addMonths(dueOn, -REQUIREMENT_SOON_MONTHS) : addMonths(facts.start, YOUTH_FOLLOWUP_REMINDER_MONTHS)
  return { state: today >= soonFrom ? 'soon' : 'ok', dueOn }
}

/** § 33 Abs. 1 Satz 2: nine months after the start the employer reminds the person of the follow-up examination. */
export const YOUTH_FOLLOWUP_REMINDER_MONTHS = 9
