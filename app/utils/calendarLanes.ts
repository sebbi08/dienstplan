import { formatTime } from '#shared/domain/time'
import type { IsoDate } from '#shared/domain/types'
import type { CalendarEventDto } from '#shared/types/api'

/** An appointment as written in the calendar's appointments row: "7. 15:00–16:00 Elternabend". */
export function calendarEventText(event: CalendarEventDto): string {
  const time = event.start === null ? '' : ` ${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`
  return `${Number(event.date.slice(8))}.${time} ${event.title}`
}

/** Rough number of characters that fit into one day column (11 px font, about 26–30 px per day). */
export const CHARS_PER_DAY = 4

/** Height of one line (lane) of the appointments row in px. */
export const LANE_HEIGHT = 15

/** Height of the appointments row in px for that many lanes (at least one line). */
export function eventRowHeight(laneCount: number): number {
  return Math.max(1, laneCount) * LANE_HEIGHT + 4
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
}

/**
 * The appointments row of a month: each text starts at its day and runs to the right on one line; when it would run
 * into an earlier text it moves to the next line (lane). A text is cut (with full text as tooltip) only where the next
 * text of its own lane begins. Per day the own appointments come first, then the automatic events. `extraChars` per
 * automatic text leaves room for its icon.
 */
export function calendarLanes(
  dates: IsoDate[], events: CalendarEventDto[], eventText: (event: CalendarEventDto) => string,
  autoEvents: Record<IsoDate, string[]>, extraChars = 1,
): { labels: CalendarLabel[]; laneCount: number } {
  const days = dates.length
  const lanes: number[] = [] // per lane: first free day index
  const labels: CalendarLabel[] = []
  const place = (key: string, item: CalendarLabelItem, text: string, start: number, chars: number) => {
    let lane = lanes.findIndex(freeFrom => freeFrom <= start)
    if (lane === -1) lane = lanes.push(0) - 1
    lanes[lane] = start + Math.max(1, Math.ceil(chars / CHARS_PER_DAY))
    labels.push({ key, item, text, start, lane, width: days - start })
  }
  dates.forEach((date, start) => {
    for (const event of events.filter(candidate => candidate.date === date)) {
      const text = eventText(event)
      place(`event-${event.id}`, { kind: 'event', event }, text, start, text.length)
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
