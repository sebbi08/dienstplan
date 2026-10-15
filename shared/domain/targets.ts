import { weekday } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
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
  return periodOn(info, date)?.workdays ?? MONDAY_TO_FRIDAY
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

export function isEmployedOn(info: EmploymentInfo, date: IsoDate): boolean {
  return weeklyMinutesOn(info, date) !== null && (info.leftOn === null || date <= info.leftOn)
}

export function isEmployedInRange(info: EmploymentInfo, from: IsoDate, to: IsoDate): boolean {
  const start = employmentStart(info)
  return start !== null && start <= to && (info.leftOn === null || info.leftOn >= from)
}

/** A day the employee is expected to work: employed, one of the contract's working days, no public holiday of the home facility. */
export function isWorkday(info: EmploymentInfo, date: IsoDate): boolean {
  return isEmployedOn(info, date) && !isHolidayIn(date, info.holidays) && worksOnWeekday(workdaysOn(info, date), weekday(date))
}

/** Weekly hours spread evenly over the working days of the valid period; 0 on all other days. */
export function dailyTarget(info: EmploymentInfo, date: IsoDate): number {
  if (!isWorkday(info, date)) return 0
  return Math.round(weeklyMinutesOn(info, date)! / workdayCount(workdaysOn(info, date)))
}
