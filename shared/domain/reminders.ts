import { addDays, daysInMonth, parseIsoDate, toIsoDate } from './dates'
import { addMonths } from './requirements'
import type { IsoDate } from './types'

// The age a child turns is `ageOn(birthDate, birthdayDate).years` from ./children; there is no second age helper here.

export type DocMode = 'off' | 'interval' | 'birthday'

export interface DocSettings {
  mode: DocMode
  intervalMonths: number
  leadWeeks: number
}

export type ReminderKind = 'doc' | 'birthday' | 'staffBirthday' | 'leaving'

export type ReminderWindow = 'before' | 'upcoming' | 'today' | 'overdue'

/** The `MM-DD` of an ISO date. */
function monthDayOf(date: IsoDate): string {
  return date.slice(5)
}

/** The day `monthDay` (`MM-DD`) falls on in `year`; 29 February becomes 28 February in non-leap years. */
function birthdayIn(monthDay: string, year: number): IsoDate {
  const [month, day] = monthDay.split('-').map(Number) as [number, number]
  return toIsoDate(year, month, Math.min(day, daysInMonth(year, month)))
}

/** Whether `value` is a day of the year as `MM-DD` (29 February included), the form of a staff birthday. */
export function isValidMonthDay(value: string): boolean {
  const match = /^(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const month = Number(match[1])
  const day = Number(match[2])
  // 2024 is a leap year, so 29 February counts.
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(2024, month)
}

/** The next occurrence of `monthDay` (`MM-DD`) on or after today (today counts); 29 February becomes 28 February in non-leap years. */
export function nextBirthday(monthDay: string, today: IsoDate): IsoDate {
  const year = parseIsoDate(today).year
  const thisYear = birthdayIn(monthDay, year)
  return thisYear >= today ? thisYear : birthdayIn(monthDay, year + 1)
}

/** The later of two optional dates (null when both are null). */
function laterOf(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

/**
 * The day the next documentation is due, or null (mode off, or interval mode with neither a done date nor any date to
 * count from). `since` is the setting's „gilt seit“ (the day the mode was switched on or last changed; null = none).
 * Without a done date it counts from the later of the entry date (else the planned entry date) and `since`, so switching
 * on does not make long-enrolled children overdue, and a missed due day stays put (overdue until done).
 * Interval: last done plus the interval; without one, that start plus the interval. Birthday: the next birthday strictly
 * after the last done date, except that a done date inside the lead window before a birthday counts for that birthday;
 * without a done date, the first birthday on or after that start (with no date at all: on or after today).
 */
export function docDue(
  input: {
    birthDate: IsoDate; entryDate: IsoDate | null; plannedEntryDate: IsoDate | null; since: IsoDate | null
    lastDone: IsoDate | null
  },
  settings: DocSettings, today: IsoDate,
): IsoDate | null {
  if (settings.mode === 'off') return null
  const start = laterOf(input.entryDate ?? input.plannedEntryDate, input.since)
  if (settings.mode === 'interval') {
    const base = input.lastDone ?? start
    return base === null ? null : addMonths(base, settings.intervalMonths)
  }
  const monthDay = monthDayOf(input.birthDate)
  if (input.lastDone === null) return nextBirthday(monthDay, start ?? today)
  const following = nextBirthday(monthDay, addDays(input.lastDone, 1))
  const inLeadWindow = input.lastDone >= addDays(following, -settings.leadWeeks * 7)
  return inLeadWindow ? nextBirthday(monthDay, addDays(following, 1)) : following
}

/**
 * Where today lies against a due day shown `leadDays` ahead: before the window, inside it, on the day, or past it.
 * Overdue is only meaningful for documentation; birthdays and leavings simply end on the day.
 */
export function inWindow(due: IsoDate, leadDays: number, today: IsoDate): ReminderWindow {
  if (today > due) return 'overdue'
  if (today === due) return 'today'
  return today < addDays(due, -leadDays) ? 'before' : 'upcoming'
}

const STATE_ORDER = { overdue: 0, today: 1, upcoming: 2 } as const
const KIND_ORDER: Record<ReminderKind, number> = { doc: 0, birthday: 1, staffBirthday: 2, leaving: 3 }

/** Overdue, then today, then upcoming; within a state by date, then kind (doc, birthday, staff birthday, leaving), then name. */
export function sortReminders<T extends { kind: ReminderKind; date: IsoDate; state: 'upcoming' | 'today' | 'overdue'; name: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) =>
    STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.name.localeCompare(b.name, 'de'))
}
