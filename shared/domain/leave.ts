import { addDays, isWeekend } from './dates'
import { isHoliday } from './holidays'
import type { IsoDate } from './types'

export interface LeaveEntitlement {
  days: number
  carriedOverDays: number
}

export interface LeaveAccount {
  entitlement: number
  carriedOver: number
  taken: number
  planned: number
  available: number
}

export interface LeaveRange {
  from: IsoDate
  to: IsoDate
  days: number
}

export function countsAsLeaveDay(date: IsoDate): boolean {
  return !isWeekend(date) && !isHoliday(date)
}

function leaveDays(dates: IsoDate[]): IsoDate[] {
  return [...new Set(dates)].filter(countsAsLeaveDay).sort()
}

export function leaveAccount(
  entitlement: LeaveEntitlement | null, vacationDates: IsoDate[], year: number, today: IsoDate,
): LeaveAccount {
  const days = leaveDays(vacationDates).filter(date => date.startsWith(`${year}-`))
  const taken = days.filter(date => date < today).length
  const planned = days.length - taken
  const total = entitlement?.days ?? 0
  const carriedOver = entitlement?.carriedOverDays ?? 0
  return { entitlement: total, carriedOver, taken, planned, available: total + carriedOver - taken - planned }
}

function nextLeaveDay(date: IsoDate): IsoDate {
  let next = addDays(date, 1)
  while (!countsAsLeaveDay(next)) next = addDays(next, 1)
  return next
}

export function groupLeaveRanges(dates: IsoDate[]): LeaveRange[] {
  const ranges: LeaveRange[] = []
  for (const date of leaveDays(dates)) {
    const current = ranges.at(-1)
    if (current && nextLeaveDay(current.to) === date) {
      current.to = date
      current.days += 1
    }
    else {
      ranges.push({ from: date, to: date, days: 1 })
    }
  }
  return ranges
}
