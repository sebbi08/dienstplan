import { parseIsoDate } from '#shared/domain/dates'
import { de } from '~/locales/de'

const pad = (value: number) => String(value).padStart(2, '0')

export function formatDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.${year}`
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
