import type { AbsenceKind, AttendanceStatus, MonthCell } from '../types/api'
import type { DomainEntry, IsoDate, Minutes } from './types'
import { isTargetGapCode } from './warnings'

/** A duty with working time: a shift or special shift counting as staff, or a timed VZ / Büro; never a break or absence. */
export function hasWorkingTime(entry: DomainEntry): boolean {
  if (entry.kind === 'shift' || entry.kind === 'special') return entry.countsAsStaff
  return entry.kind === 'code' && entry.countsAsStaff && isTargetGapCode(entry.codeKey) && entry.start !== null && entry.end !== null
}

/**
 * Per group (keyed by id) and date: the number of persons with at least one duty with working time whose effective
 * group (the entry's group, otherwise the person's home group) it is. Only the plan's own cells count: entries planned
 * in another facility (help-elsewhere markers) never do. Duties without an effective group count nowhere.
 */
export function groupAttendance(
  facilityId: number,
  groupIds: number[],
  homeGroups: Map<number, number | null>,
  entries: (DomainEntry & { helpFacilityId?: number | null })[],
  dates: IsoDate[],
): Record<string, Record<IsoDate, number>> {
  const persons = new Map<string, Set<number>>()
  for (const entry of entries) {
    if (entry.helpFacilityId != null && entry.helpFacilityId !== facilityId) continue
    if (!hasWorkingTime(entry)) continue
    const groupId = entry.groupId ?? homeGroups.get(entry.employeeId) ?? null
    if (groupId === null) continue
    const key = `${groupId}|${entry.date}`
    persons.set(key, (persons.get(key) ?? new Set()).add(entry.employeeId))
  }
  return Object.fromEntries(groupIds.map(groupId => [
    String(groupId),
    Object.fromEntries(dates.map(date => [date, persons.get(`${groupId}|${date}`)?.size ?? 0])),
  ]))
}

// --- Child attendance (Gruppenbuch): status of a day, meal counting, overdue pickup, month cells ---

/** One stay of a child on a day: arrival and departure in minutes after midnight (null while still there). */
export interface StaySpan { arrived: Minutes, left: Minutes | null }

/**
 * The status of a child on a day. Stays win over an absence (the child came after all); without stay and absence a past
 * care day is unexcused, everything else is not yet.
 */
export function dayStatus(input: {
  stays: StaySpan[]
  absence: AbsenceKind | null
  date: IsoDate
  today: IsoDate
  isCareDay: boolean
}): AttendanceStatus {
  if (input.stays.some(stay => stay.left === null)) return 'present'
  if (input.stays.length > 0) return 'gone'
  if (input.absence !== null) return input.absence
  if (input.date < input.today && input.isCareDay) return 'unexcused'
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
