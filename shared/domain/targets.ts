import { weekday } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
import type { LongAbsencePeriod } from './longAbsence'
import type { ParentalLeavePeriod } from './parentalLeave'
import type { IsoDate } from './types'

/** Working days as a bitmask: bit 0 = Monday … bit 6 = Sunday. */
export const MONDAY_TO_FRIDAY = 0b0011111

export interface HoursPeriod {
  weeklyMinutes: number
  validFrom: IsoDate
  /** Working days of this period (bitmask); missing = Monday to Friday. */
  workdays?: number
}

export interface EmploymentInfo {
  hours: HoursPeriod[]
  leftOn: IsoDate | null
  /** Public-holiday rules of the home facility: they decide the working days everywhere, help-outs included. */
  holidays: HolidayRules
  /**
   * „Stundenkonto ab“: the hours account starts no earlier than this day (null/missing = with the first weekly hours).
   * Only the balance reads it (see balanceStart); working days, targets and leave do not.
   */
  balanceFrom?: IsoDate | null
  /**
   * Elternzeit (shared/domain/parentalLeave.ts): a full one has no working days and no target; with part-time work the
   * target follows its weekly hours on the contract's working days (missing = none).
   */
  parentalLeaves?: readonly ParentalLeavePeriod[]
  /**
   * „Längere Abwesenheit“ (shared/domain/longAbsence.ts): Langzeitkrank and Kur/Reha keep the working days and credit
   * their target (longSickOn, balance.ts); Sonstiges has no working days and no target, like a full Elternzeit (missing = none).
   */
  longAbsences?: readonly LongAbsencePeriod[]
}

/** The entered long absence on the date (the same lookup as longAbsenceOn, kept here so targets.ts imports no other module). */
function longAbsenceOf(info: EmploymentInfo, date: IsoDate): LongAbsencePeriod | null {
  return info.longAbsences?.find(period => period.start <= date && (period.end === null || date <= period.end)) ?? null
}

/**
 * A day of Langzeitkrank or Kur/Reha: the hours account credits its daily target as for a whole day „Krank“
 * (computeDay), and it counts as a sick day on the person's working days (no plan entry is stored).
 */
export function longSickOn(info: EmploymentInfo, date: IsoDate): boolean {
  const reason = longAbsenceOf(info, date)?.reason
  return reason === 'sick' || reason === 'rehab'
}

/** The Elternzeit on the date (the same lookup as parentalLeaveOn, kept here so targets.ts imports no other module). */
function parentalLeaveOf(info: EmploymentInfo, date: IsoDate): ParentalLeavePeriod | null {
  return info.parentalLeaves?.find(period => period.start <= date && date <= period.end) ?? null
}

function periodOn(info: EmploymentInfo, date: IsoDate): HoursPeriod | null {
  let match: HoursPeriod | null = null
  for (const period of info.hours) {
    if (period.validFrom <= date && (!match || period.validFrom > match.validFrom)) match = period
  }
  return match
}

export function weeklyMinutesOn(info: EmploymentInfo, date: IsoDate): number | null {
  return periodOn(info, date)?.weeklyMinutes ?? null
}

/** Working-day bitmask valid on that date (Monday to Friday when not employed). */
export function workdaysOn(info: EmploymentInfo, date: IsoDate): number {
  // During part-time work in an Elternzeit: its own working days when entered.
  const leave = parentalLeaveOf(info, date)
  if (leave && leave.partTimeWeeklyMinutes !== null && leave.partTimeWorkdays) return leave.partTimeWorkdays
  return periodOn(info, date)?.workdays ?? MONDAY_TO_FRIDAY
}

/**
 * The weekly hours agreed for the date: the contract's; during part-time work in an Elternzeit its hours, 0 in a full
 * Elternzeit (null when not employed). The one source of dailyTarget and of the MuSchG limit of the agreed working time.
 */
export function weeklyTargetMinutesOn(info: EmploymentInfo, date: IsoDate): number | null {
  const weekly = weeklyMinutesOn(info, date)
  if (weekly === null) return null
  const leave = parentalLeaveOf(info, date)
  return leave === null ? weekly : leave.partTimeWeeklyMinutes ?? 0
}

export function worksOnWeekday(workdays: number, weekdayIndex: number): boolean {
  return ((workdays >> weekdayIndex) & 1) === 1
}

export function workdayCount(workdays: number): number {
  let count = 0
  for (let index = 0; index < 7; index++) if (worksOnWeekday(workdays, index)) count++
  return count
}

export function employmentStart(info: EmploymentInfo): IsoDate | null {
  if (info.hours.length === 0) return null
  return info.hours.reduce((min, period) => (period.validFrom < min ? period.validFrom : min), info.hours[0]!.validFrom)
}

/**
 * First day the hours account counts target and worked time: the first weekly hours, or „Stundenkonto ab“ when that is
 * later (null without weekly hours).
 */
export function balanceStart(info: EmploymentInfo): IsoDate | null {
  const start = employmentStart(info)
  if (start === null) return null
  return info.balanceFrom != null && info.balanceFrom > start ? info.balanceFrom : start
}

/**
 * The day counts in the hours account (from balanceStart on). The one rule for everything that adds up targets against
 * credited time: the balance, the plan's week differences and the time sheet's month totals.
 */
export function countsForBalance(info: EmploymentInfo, date: IsoDate): boolean {
  const start = balanceStart(info)
  return start !== null && date >= start
}

export function isEmployedOn(info: EmploymentInfo, date: IsoDate): boolean {
  return weeklyMinutesOn(info, date) !== null && (info.leftOn === null || date <= info.leftOn)
}

export function isEmployedInRange(info: EmploymentInfo, from: IsoDate, to: IsoDate): boolean {
  const start = employmentStart(info)
  return start !== null && start <= to && (info.leftOn === null || info.leftOn >= from)
}

/**
 * A day the employee is expected to work: employed, one of the contract's working days, no public holiday of the home
 * facility, not in a full Elternzeit (part-time work during it keeps the working days), not in a long absence
 * „Sonstiges“ (unpaid, no target; Langzeitkrank and Kur/Reha keep the working days: they are sick days).
 */
export function isWorkday(info: EmploymentInfo, date: IsoDate): boolean {
  if (!isEmployedOn(info, date) || isHolidayIn(date, info.holidays) || !worksOnWeekday(workdaysOn(info, date), weekday(date))) return false
  if (longAbsenceOf(info, date)?.reason === 'other') return false
  const leave = parentalLeaveOf(info, date)
  return leave === null || leave.partTimeWeeklyMinutes !== null
}

/**
 * Weekly hours spread evenly over the working days of the valid period (during part-time work in an Elternzeit its
 * weekly hours); 0 on all other days.
 */
export function dailyTarget(info: EmploymentInfo, date: IsoDate): number {
  if (!isWorkday(info, date)) return 0
  const weekly = weeklyTargetMinutesOn(info, date)!
  return Math.round(weekly / workdayCount(workdaysOn(info, date)))
}
