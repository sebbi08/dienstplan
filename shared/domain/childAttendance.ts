import type { AbsenceKind, AttendanceStatus, MonthCell } from '../types/api'
import type { IsoDate, Minutes } from './types'

// Child attendance (Gruppenbuch): status of a day, meal counting, overdue pickup, month cells.

/** One stay of a child on a day: arrival and departure in minutes after midnight (null while still there). */
export interface StaySpan { arrived: Minutes, left: Minutes | null }

/**
 * The status of a child on a day. Stays win over an absence (the child came after all); without stay and absence a past
 * care day is unexcused once the facility records attendance (`recordedFrom`, null = not yet), everything else is not yet.
 */
export function dayStatus(input: {
  stays: StaySpan[]
  absence: AbsenceKind | null
  date: IsoDate
  today: IsoDate
  isCareDay: boolean
  recordedFrom: IsoDate | null
}): AttendanceStatus {
  if (input.stays.some(stay => stay.left === null)) return 'present'
  if (input.stays.length > 0) return 'gone'
  if (input.absence !== null) return input.absence
  const recorded = input.recordedFrom !== null && input.date >= input.recordedFrom
  if (recorded && input.date < input.today && input.isCareDay) return 'unexcused'
  return 'not_yet'
}

/**
 * Whether a child counts for a meal at `mealTime`: a manual tick wins; otherwise some stay must cover the time. An open
 * stay lasts until the planned pickup (forever without one).
 */
export function countsForMeal(
  mealTime: Minutes,
  stays: StaySpan[],
  plannedPickup: Minutes | null,
  manual: boolean | null,
): boolean {
  if (manual !== null) return manual
  return stays.some(stay => stay.arrived <= mealTime
    && (stay.left !== null ? stay.left > mealTime : (plannedPickup === null || plannedPickup > mealTime)))
}

/** Minutes after the planned pickup time before the row is marked as overdue. */
export const OVERDUE_MINUTES = 15

/** An open stay on today's list whose planned pickup is at least `OVERDUE_MINUTES` ago. */
export function pickupOverdue(stays: StaySpan[], plannedPickup: Minutes | null, isToday: boolean, now: Minutes): boolean {
  return isToday
    && plannedPickup !== null
    && stays.some(stay => stay.left === null)
    && now >= plannedPickup + OVERDUE_MINUTES
}

/** The month table's cell for a day status (here and already picked up both count as present). */
export function monthCell(status: AttendanceStatus): MonthCell {
  if (status === 'present' || status === 'gone') return 'present'
  if (status === 'not_yet') return 'none'
  return status
}

/** Per kind the number of cells in a child's month row; empty cells are not counted. */
export function monthSums(cells: MonthCell[]): Record<Exclude<MonthCell, 'none'>, number> {
  const sums = { present: 0, sick: 0, vacation: 0, excused: 0, unexcused: 0 }
  for (const cell of cells) if (cell !== 'none') sums[cell]++
  return sums
}
