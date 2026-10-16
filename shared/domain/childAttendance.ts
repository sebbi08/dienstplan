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

/** Whether two stays of a day share some time (an open stay lasts the rest of the day); stays that only touch do not. */
export function staysOverlap(a: StaySpan, b: StaySpan): boolean {
  return a.arrived < (b.left ?? Infinity) && b.arrived < (a.left ?? Infinity)
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

/** A name as compared with the names of the persons in the record: trimmed, single spaces, lower case. */
export const personKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')

/** The name among `names` that is the typed one (compared as `personKey`); undefined for none or an empty name. */
export function sameName(names: string[], typed: string): string | undefined {
  const key = personKey(typed)
  return key === '' ? undefined : names.find(name => personKey(name) === key)
}

/** The pickup person of a stay as the history knows it: `other` = typed by hand ("nicht hinterlegt"). */
export interface LoggedPickup { name: string; other: boolean; confirmedWith: string }

/**
 * The pickup person as a logged value: '' for nobody, the plain name for a registered person, and for a person typed
 * by hand the name with the mark and the "Rücksprache mit" (as JSON), so both sides of a logged change show the mark.
 */
export function pickupLogValue(person: { name: string | null; other: boolean; confirmedWith: string }): string {
  if (person.name === null) return ''
  return person.other ? JSON.stringify({ other: person.name, confirmedWith: person.confirmedWith }) : person.name
}

/** A logged value of the pickup person read back (see `pickupLogValue`); null for nobody. */
export function readPickupLogValue(value: string): LoggedPickup | null {
  if (value === '') return null
  if (value.startsWith('{"other":')) {
    try {
      const parsed = JSON.parse(value) as { other?: unknown; confirmedWith?: unknown }
      if (typeof parsed.other === 'string') {
        return { name: parsed.other, other: true, confirmedWith: typeof parsed.confirmedWith === 'string' ? parsed.confirmedWith : '' }
      }
    }
    catch {
      // Not the mark: a name that only looks like it.
    }
  }
  return { name: value, other: false, confirmedWith: '' }
}

/** Per kind the number of cells in a child's month row; empty cells are not counted. */
export function monthSums(cells: MonthCell[]): Record<Exclude<MonthCell, 'none'>, number> {
  const sums = { present: 0, sick: 0, vacation: 0, excused: 0, unexcused: 0 }
  for (const cell of cells) if (cell !== 'none') sums[cell]++
  return sums
}
