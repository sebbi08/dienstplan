import { weekday } from '#shared/domain/dates'
import { eventCovers, eventDayCount, eventLastDay, eventRangeText } from '#shared/domain/calendarEvents'
import { formatTime } from '#shared/domain/time'
import type { IsoDate } from '#shared/domain/types'
import type { CalendarEventDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDayShort } from './format'

/** The date column of the appointment lists: „Mi 14.10.2026“, over several days „Di 10.03.2026 – Do 12.03.2026“. */
export function eventListDateText(event: CalendarEventDto): string {
  const day = (date: IsoDate) => `${formatDayShort(date, weekday(date))}${date.slice(0, 4)}`
  return event.endDate === null ? day(event.date) : `${day(event.date)} – ${day(event.endDate)}`
}

/**
 * „Wer sieht ihn?“ in the managers' list: the choice, for groups and people with the names the calendar knows
 * („Bestimmte Gruppen: Bären, Igel“).
 */
export function eventVisibilityText(event: CalendarEventDto, calendar: Pick<YearCalendarDto, 'groups' | 'employees'> | null | undefined): string {
  const label = de.calendar.visibilityLabels[event.visibility]
  if (event.visibility === 'groups') {
    return de.calendar.visibilityText(label, event.groupIds.map(id => calendar?.groups.find(group => group.id === id)?.name ?? '').filter(Boolean))
  }
  if (event.visibility === 'employees') {
    return de.calendar.visibilityText(label, event.employeeIds.map(id => calendar?.employees.find(row => row.id === id)?.name ?? '').filter(Boolean))
  }
  return label
}

/** The time of a one-day appointment: „19:00“, „19:00–21:00“ or „bis 12:00“ ('' without one). */
export function eventTimeText(event: Pick<CalendarEventDto, 'start' | 'end'>): string {
  if (event.start === null) return event.end === null ? '' : de.calendar.eventUntil(formatTime(event.end))
  return `${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`
}

/**
 * The time column of the appointment lists: a one-day appointment its time; a longer one the start time on its first
 * day and the end time on its last („Beginn 9:00 · Ende 16:00“; '' without times).
 */
export function eventListTimeText(event: CalendarEventDto): string {
  if (eventDayCount(event) === 1) return eventTimeText(event)
  return [
    event.start === null ? '' : de.calendar.eventStarts(formatTime(event.start)),
    event.end === null ? '' : de.calendar.eventEnds(formatTime(event.end)),
  ].filter(Boolean).join(' · ')
}

/**
 * An appointment as written in the calendar's appointments row: „7. 15:00–16:00 Elternabend“; over several days with
 * its days, without times: „10.–12.3. Fortbildungstage“ (the times stand in the list and the tooltip).
 */
export function calendarEventText(event: CalendarEventDto): string {
  if (eventDayCount(event) > 1) return `${eventRangeText(event)} ${event.title}`
  const time = eventTimeText(event)
  return `${Number(event.date.slice(8))}.${time ? ` ${time}` : ''} ${event.title}`
}

/** The full text of an appointment (tooltips): its days, its time and its title. */
export function calendarEventTitle(event: CalendarEventDto): string {
  return [eventRangeText(event), eventListTimeText(event), event.title].filter(Boolean).join(' ')
}

/**
 * The appointment on one of its days in the plan (Info 2, „Mein Dienstplan“): a one-day appointment „Elternabend
 * 19:00–21:00“; a longer one with its days „Fortbildungstage 10.–12.3.“, on the first day with „ab 9:00“, on the last
 * with „bis 16:00“ when those times are entered.
 */
export function eventDayText(event: CalendarEventDto, date: IsoDate): string {
  if (eventDayCount(event) === 1) return [event.title, eventTimeText(event)].filter(Boolean).join(' ')
  const parts = [event.title, eventRangeText(event)]
  if (date === event.date && event.start !== null) parts.push(de.calendar.eventFrom(formatTime(event.start)))
  if (date === eventLastDay(event) && event.end !== null) parts.push(de.calendar.eventUntil(formatTime(event.end)))
  return parts.join(' ')
}

/** The appointments touching the days (a month of the calendar). */
export function eventsInDays(events: CalendarEventDto[], dates: IsoDate[]): CalendarEventDto[] {
  const first = dates[0]
  const last = dates.at(-1)
  if (!first || !last) return []
  return events.filter(event => event.date <= last && eventLastDay(event) >= first)
}

/** Rough number of characters that fit into one day column (11 px font, about 26–30 px per day). */
export const CHARS_PER_DAY = 4

/** Height of one line (lane) of the appointments row in px; the compact print uses smaller lines. */
export const LANE_HEIGHT = 15
export const PRINT_LANE_HEIGHT = 12

/** Height of the appointments row in px for that many lanes (at least one line); `print`: the compact print row. */
export function eventRowHeight(laneCount: number, print = false): number {
  return Math.max(1, laneCount) * (print ? PRINT_LANE_HEIGHT : LANE_HEIGHT) + (print ? 2 : 4)
}

/** An own appointment (clickable for managers) or an automatic event of the day (read-only). */
export type CalendarLabelItem = { kind: 'event'; event: CalendarEventDto } | { kind: 'auto'; text: string }

export interface CalendarLabel {
  key: string
  item: CalendarLabelItem
  text: string
  /** Day index (0 = 1st) the text starts at. */
  start: number
  lane: number
  /** Days the text may cover before it is cut. */
  width: number
  /** Days the appointment itself covers from `start` (its bar; 1 for a one-day appointment or an automatic event). */
  days: number
}

/**
 * The appointments row of a month: each text starts at its day and runs to the right on one line; when it would run
 * into an earlier text it moves to the next line (lane). A text is cut (with full text as tooltip) only where the next
 * text of its own lane begins. Per day the own appointments come first, then the automatic events. `extraChars` per
 * automatic text leaves room for its icon. An appointment over several days starts at its first day in `dates` and
 * keeps its lane for all its days there (`days`), however short its text.
 */
export function calendarLanes(
  dates: IsoDate[], events: CalendarEventDto[], eventText: (event: CalendarEventDto) => string,
  autoEvents: Record<IsoDate, string[]>, extraChars = 1,
): { labels: CalendarLabel[]; laneCount: number } {
  const days = dates.length
  const lanes: number[] = [] // per lane: first free day index
  const labels: CalendarLabel[] = []
  const place = (key: string, item: CalendarLabelItem, text: string, start: number, chars: number, span = 1) => {
    let lane = lanes.findIndex(freeFrom => freeFrom <= start)
    if (lane === -1) lane = lanes.push(0) - 1
    lanes[lane] = start + Math.max(span, Math.ceil(chars / CHARS_PER_DAY))
    labels.push({ key, item, text, start, lane, width: days - start, days: span })
  }
  dates.forEach((date, start) => {
    // An appointment starts on its first day, or on the first day shown when it began earlier.
    for (const event of events.filter(candidate => candidate.date === date || (start === 0 && eventCovers(candidate, date)))) {
      const text = eventText(event)
      const span = dates.slice(start).filter(day => eventCovers(event, day)).length
      place(`event-${event.id}`, { kind: 'event', event }, text, start, text.length, span)
    }
    ;(autoEvents[date] ?? []).forEach((auto, index) => {
      const text = `${Number(date.slice(8))}. ${auto}`
      place(`auto-${date}-${index}`, { kind: 'auto', text: auto }, text, start, text.length + extraChars)
    })
  })
  for (const label of labels) {
    const next = labels.filter(other => other.lane === label.lane && other.start > label.start).map(other => other.start)
    if (next.length) label.width = Math.min(...next) - label.start
  }
  return { labels, laneCount: lanes.length }
}
