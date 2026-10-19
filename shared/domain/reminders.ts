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

/** The next occurrence of `monthDay` (`MM-DD`) on or after today (today counts); 29 February becomes 28 February in non-leap years. */
export function nextBirthday(monthDay: string, today: IsoDate): IsoDate {
  const year = parseIsoDate(today).year
  const thisYear = birthdayIn(monthDay, year)
  return thisYear >= today ? thisYear : birthdayIn(monthDay, year + 1)
}

/**
 * The day the next documentation is due, or null (mode off, or interval mode with neither a done date nor any entry
 * date). Interval: last done plus the interval; without one, the entry date (else the planned entry date) plus the
 * interval. Birthday: the next birthday strictly after the last done date, except that a done date inside the lead window
 * before a birthday counts for that birthday; without a done date, the next birthday on or after today.
 */
export function docDue(
  input: { birthDate: IsoDate; entryDate: IsoDate | null; plannedEntryDate: IsoDate | null; lastDone: IsoDate | null },
  settings: DocSettings, today: IsoDate,
): IsoDate | null {
  if (settings.mode === 'off') return null
  if (settings.mode === 'interval') {
    const base = input.lastDone ?? input.entryDate ?? input.plannedEntryDate
    return base === null ? null : addMonths(base, settings.intervalMonths)
  }
  const monthDay = monthDayOf(input.birthDate)
  if (input.lastDone === null) return nextBirthday(monthDay, today)
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
