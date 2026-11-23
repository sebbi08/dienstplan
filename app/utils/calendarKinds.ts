import { addDays, isWeekend } from '#shared/domain/dates'
import { isHolidayIn } from '#shared/domain/holidays'
import type { CalendarKind, YearCalendarDto } from '#shared/types/api'

/**
 * The legend lines shown only when the calendar holds such a day: „Krank“ and „Mutterschutz / Beschäftigungsverbot“
 * reach only viewers with the health data (the server sends everybody else „abwesend“), and „abwesend“ itself only where
 * it occurs, so the legend never explains „abwesend“ to someone without the right.
 */
export const CONDITIONAL_KINDS: readonly CalendarKind[] = ['sick', 'maternity', 'absent', 'parental_leave']

/** The kinds that occur in the calendar's days. */
export function presentKinds(days: YearCalendarDto['days'] | null | undefined): Set<CalendarKind> {
  const kinds = new Set<CalendarKind>()
  for (const row of Object.values(days ?? {})) for (const kind of Object.values(row)) kinds.add(kind)
  return kinds
}

/** Whether the legend lists the kind: always, unless it is one of CONDITIONAL_KINDS absent from the days. */
export function legendShowsKind(kind: CalendarKind, present: ReadonlySet<CalendarKind>): boolean {
  return !CONDITIONAL_KINDS.includes(kind) || present.has(kind)
}

/**
 * The days an absence entered for a range lands on: Monday to Friday without the public holidays and the person's days
 * off, and never on a day the viewer may not change: „abwesend“ (a private absence or a masked Elternzeit) or a full
 * Elternzeit (no working day; nothing is booked there).
 */
export function absenceDates(calendar: Pick<YearCalendarDto, 'days' | 'freeDays' | 'holidays'> | null | undefined, employeeId: number, from: string, to: string): string[] {
  const free = new Set(calendar?.freeDays[employeeId] ?? [])
  const days = calendar?.days[employeeId] ?? {}
  const dates: string[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isWeekend(date) || (calendar && isHolidayIn(date, calendar.holidays)) || free.has(date)) continue
    if (days[date] !== 'absent' && days[date] !== 'parental_leave') dates.push(date)
  }
  return dates
}
