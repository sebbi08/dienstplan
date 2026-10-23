import { parseIsoDate } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import { de } from '~/locales/de'

const pad = (value: number) => String(value).padStart(2, '0')

export function formatDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.${year}`
}

/** A day without the year: "01.11.". */
export function formatDayMonth(iso: string): string {
  const { month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.`
}

/** A day without the year when it lies in the year of `today` ("01.11."), else with it ("03.04.2024"). */
export function formatDayMonthNear(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(iso) : formatDate(iso)
}

export function formatDayShort(iso: string, weekdayIndex: number): string {
  const { month, day } = parseIsoDate(iso)
  return `${de.weekdaysShort[weekdayIndex]} ${pad(day)}.${pad(month)}.`
}

export function formatDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(timestamp))
}

/** The time of day of a timestamp in Berlin, e.g. "14:35" (for short locks that end the same day). */
export function formatClockTime(timestamp: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

/** Two days as short as they stay clear: "19.–23.10.2026", "28.09.–02.10.2026", "28.12.2026–01.01.2027". */
export function formatDateSpan(from: string, to: string): string {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  const head = start.year !== end.year
    ? formatDate(from)
    : start.month !== end.month ? `${pad(start.day)}.${pad(start.month)}.` : `${pad(start.day)}.`
  return `${head}–${formatDate(to)}`
}

/** A time record as "7:42–11:40", open records as "7:42–…". */
export function formatSpan(record: { start: number; end: number | null }): string {
  return `${formatTime(record.start)}–${record.end === null ? '…' : formatTime(record.end)}`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

export function formatHours(minutes: number | null): string {
  return minutes === null ? '–' : formatNumber(minutes / 60)
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}

export function monthTitle(year: number, month: number): string {
  return `${de.months[month - 1]} ${year}`
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}
