import { daysBetween, parseIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * The facility's own appointments (Jahreskalender → „Termine“, Dienstplan → Info 2): one appointment shows in both
 * places, on every day from `date` to `endDate` (null = one day).
 *
 * „Wer sieht den Termin?“ (required): `all` – every employee of the facility, the tablet and the printouts; `groups` –
 * the employees whose home group is one of the chosen groups; `employees` – the chosen employees; `leaders` – nobody but
 * the Leitung and the Träger. Leitung, Träger and whoever manages the calendar (calendar.edit) always see every
 * appointment of their facility (eventAudienceOf, server/services/calendar.ts); everyone else only what is meant for
 * them, filtered on the server.
 */
export const EVENT_VISIBILITIES = ['all', 'groups', 'employees', 'leaders'] as const
export type EventVisibility = typeof EVENT_VISIBILITIES[number]

/** The longest appointment in days (first and last day included). */
export const MAX_EVENT_DAYS = 366

/** Who looks at the appointments: everything (managers) or as the employee in their home group (null = none). */
export interface EventAudience {
  seesAll: boolean
  employeeId: number | null
  groupId: number | null
}

/** The tablet without an unlock, or an account without an employee: only „Alle“. */
export const PUBLIC_AUDIENCE: EventAudience = { seesAll: false, employeeId: null, groupId: null }

/** Whether the viewer sees every appointment of the facility: Träger, Leitung and whoever manages the calendar. */
export const seesAllEvents = (role: string, canEditCalendar: boolean): boolean =>
  role === 'provider' || role === 'admin' || canEditCalendar

/**
 * The printouts (plan, year calendar) get hung up: they show only appointments for „Alle“, for every viewer. The print
 * pages ask with `?print=1`; a viewer who sees all may add `&internal=1` („Interne Termine mitdrucken“) to print every
 * appointment, marked in the heading. The server honours both (eventAudienceForPrint).
 */
export const PRINT_QUERY = 'print'
export const INTERNAL_QUERY = 'internal'

interface EventSpan { date: IsoDate; endDate: IsoDate | null }

/** The last day of the appointment (the first for a one-day appointment). */
export const eventLastDay = (event: EventSpan): IsoDate => event.endDate ?? event.date

/** Whether the appointment is on that day. */
export const eventCovers = (event: EventSpan, date: IsoDate): boolean => event.date <= date && date <= eventLastDay(event)

/** Whether the appointment touches the range from–to (both included). */
export const eventOverlaps = (event: EventSpan, from: IsoDate, to: IsoDate): boolean => event.date <= to && eventLastDay(event) >= from

/** Number of days of the appointment (1 for one day). */
export const eventDayCount = (event: EventSpan): number => daysBetween(event.date, eventLastDay(event)) + 1

/** Whether the appointment is meant for this audience (a list left empty shows to nobody but the managers). */
export function eventVisibleTo(
  event: { visibility: EventVisibility; groupIds: readonly number[]; employeeIds: readonly number[] }, audience: EventAudience,
): boolean {
  if (audience.seesAll) return true
  switch (event.visibility) {
    case 'all': return true
    case 'groups': return audience.groupId !== null && event.groupIds.includes(audience.groupId)
    case 'employees': return audience.employeeId !== null && event.employeeIds.includes(audience.employeeId)
    default: return false
  }
}

/** „10.–12.3.“, „30.3.–2.4.“, „30.12.2026–2.1.2027“; one day: „14.10.“. */
export function eventRangeText(event: EventSpan): string {
  const first = parseIsoDate(event.date)
  if (event.endDate === null || event.endDate === event.date) return `${first.day}.${first.month}.`
  const last = parseIsoDate(event.endDate)
  if (first.year !== last.year) return `${first.day}.${first.month}.${first.year}–${last.day}.${last.month}.${last.year}`
  if (first.month !== last.month) return `${first.day}.${first.month}.–${last.day}.${last.month}.`
  return `${first.day}.–${last.day}.${last.month}.`
}
