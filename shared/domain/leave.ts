import { addDays, isWeekend } from './dates'
import { halfOnEveDay, type EveRule } from './eveRules'
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
 * Whether 24 and 31 December weigh half a leave day: the (home) facility's rules per year (half in a year whose rule is
 * 'half'; in a 'paid' year the days are no leave days at all), or a plain yes/no for every year.
 */
export type HalfOnEves = boolean | readonly EveRule[]

/**
 * How much of the entitlement a leave day uses: half a day on 24 and 31 December in a year the (home) facility counts
 * them so (`halfOnEves`), otherwise a whole day.
 */
export function leaveDayWeight(date: IsoDate, halfOnEves: HalfOnEves): 1 | 0.5 {
  return halfOnEveDay(date, halfOnEves) ? 0.5 : 1
}

/** The leave days the dates use up, each with its weight (the dates are leave days already, each once). */
export function countLeaveDays(dates: IsoDate[], halfOnEves: HalfOnEves): number {
  return dates.reduce((sum, date) => sum + leaveDayWeight(date, halfOnEves), 0)
}

/**
 * The dates that fit into the leave that is left, taken in their order: a day that no longer fits is skipped, so a
 * later half day (31 December) can still use the half day left. None when nothing or less than half a day is left.
 * With whole days only this is the first floor(available) dates, as before.
 */
export function leaveDaysThatFit(dates: IsoDate[], available: number, halfOnEves: HalfOnEves): IsoDate[] {
  let used = 0
  const fitting: IsoDate[] = []
  for (const date of dates) {
    const weight = leaveDayWeight(date, halfOnEves)
    if (used + weight > available) continue
    used += weight
    fitting.push(date)
  }
  return fitting
}

export function leaveAccount(
  entitlement: LeaveEntitlement | null, vacationDates: IsoDate[], year: number, today: IsoDate,
  isLeaveDay: LeaveDayRule, halfOnEves: HalfOnEves = false,
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
export function groupLeaveRanges(dates: IsoDate[], isLeaveDay: LeaveDayRule, halfOnEves: HalfOnEves = false): LeaveRange[] {
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
