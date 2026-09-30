import { isWeekend } from './dates'
import { isHoliday } from './holidays'
import type { IsoDate } from './types'

export interface HoursPeriod {
  weeklyMinutes: number
  validFrom: IsoDate
}

export interface EmploymentInfo {
  hours: HoursPeriod[]
  leftOn: IsoDate | null
}

export function weeklyMinutesOn(info: EmploymentInfo, date: IsoDate): number | null {
  let match: HoursPeriod | null = null
  for (const period of info.hours) {
    if (period.validFrom <= date && (!match || period.validFrom > match.validFrom)) match = period
  }
  return match ? match.weeklyMinutes : null
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

export function dailyTarget(info: EmploymentInfo, date: IsoDate): number {
  if (!isEmployedOn(info, date) || isWeekend(date) || isHoliday(date)) return 0
  return Math.round(weeklyMinutesOn(info, date)! / 5)
}
