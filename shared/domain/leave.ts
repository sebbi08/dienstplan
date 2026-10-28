import { addDays, isWeekend } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
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

/** Monday to Friday without the public holidays of the rules. */
export function countsAsLeaveDay(date: IsoDate, rules: HolidayRules): boolean {
  return !isWeekend(date) && !isHolidayIn(date, rules)
}

/** Decides which dates count as leave days; per employee this is their working days (`isWorkday`). */
export type LeaveDayRule = (date: IsoDate) => boolean

function leaveDays(dates: IsoDate[], isLeaveDay: LeaveDayRule): IsoDate[] {
  return [...new Set(dates)].filter(isLeaveDay).sort()
}

/**
 * How much of the entitlement a leave day uses: half a day on 24 and 31 December when the (home) facility counts them
 * so (`halfOnEves`, the facility setting „Urlaub am 24.12. und 31.12. zählt als halber Tag“), otherwise a whole day.
 */
export function leaveDayWeight(date: IsoDate, halfOnEves: boolean): 1 | 0.5 {
  return halfOnEves && (date.endsWith('-12-24') || date.endsWith('-12-31')) ? 0.5 : 1
}

/** The leave days the dates use up, each with its weight (the dates are leave days already, each once). */
export function countLeaveDays(dates: IsoDate[], halfOnEves: boolean): number {
  return dates.reduce((sum, date) => sum + leaveDayWeight(date, halfOnEves), 0)
}

/** How many of the dates, in their order, fit into the leave that is left (none when nothing or less is left). */
export function leaveDaysThatFit(dates: IsoDate[], available: number, halfOnEves: boolean): number {
  let used = 0
  let count = 0
  for (const date of dates) {
    used += leaveDayWeight(date, halfOnEves)
    if (used > available) break
    count++
  }
  return count
}

export function leaveAccount(
  entitlement: LeaveEntitlement | null, vacationDates: IsoDate[], year: number, today: IsoDate,
  isLeaveDay: LeaveDayRule, halfOnEves = false,
): LeaveAccount {
  const days = leaveDays(vacationDates, isLeaveDay).filter(date => date.startsWith(`${year}-`))
  const taken = countLeaveDays(days.filter(date => date < today), halfOnEves)
  const planned = countLeaveDays(days, halfOnEves) - taken
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

/** Periods of consecutive leave days with the days they use (halfOnEves: see leaveDayWeight; sick periods never). */
export function groupLeaveRanges(dates: IsoDate[], isLeaveDay: LeaveDayRule, halfOnEves = false): LeaveRange[] {
  const ranges: LeaveRange[] = []
  for (const date of leaveDays(dates, isLeaveDay)) {
    const current = ranges.at(-1)
    const weight = leaveDayWeight(date, halfOnEves)
    if (current && nextLeaveDay(current.to, isLeaveDay) === date) {
      current.to = date
      current.days += weight
    }
    else {
      ranges.push({ from: date, to: date, days: weight })
    }
  }
  return ranges
}
