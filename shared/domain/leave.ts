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

/** Decides which dates count as leave days; per employee this is their working days (default Monday–Friday). */
export type LeaveDayRule = (date: IsoDate) => boolean

function leaveDays(dates: IsoDate[], isLeaveDay: LeaveDayRule): IsoDate[] {
  return [...new Set(dates)].filter(isLeaveDay).sort()
}

export function leaveAccount(
  entitlement: LeaveEntitlement | null, vacationDates: IsoDate[], year: number, today: IsoDate,
  isLeaveDay: LeaveDayRule = countsAsLeaveDay,
): LeaveAccount {
  const days = leaveDays(vacationDates, isLeaveDay).filter(date => date.startsWith(`${year}-`))
  const taken = days.filter(date => date < today).length
  const planned = days.length - taken
  const total = entitlement?.days ?? 0
  const carriedOver = entitlement?.carriedOverDays ?? 0
  return { entitlement: total, carriedOver, taken, planned, available: total + carriedOver - taken - planned }
}

/** Next leave day after date, looking at most two weeks ahead (null when none follows soon). */
function nextLeaveDay(date: IsoDate, isLeaveDay: LeaveDayRule): IsoDate | null {
  let next = addDays(date, 1)
  for (let step = 0; step < 14; step++, next = addDays(next, 1)) if (isLeaveDay(next)) return next
  return null
}

export function groupLeaveRanges(dates: IsoDate[], isLeaveDay: LeaveDayRule = countsAsLeaveDay): LeaveRange[] {
  const ranges: LeaveRange[] = []
  for (const date of leaveDays(dates, isLeaveDay)) {
    const current = ranges.at(-1)
    if (current && nextLeaveDay(current.to, isLeaveDay) === date) {
      current.to = date
      current.days += 1
    }
    else {
      ranges.push({ from: date, to: date, days: 1 })
    }
  }
  return ranges
}
