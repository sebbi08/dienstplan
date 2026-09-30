import type { IsoDate } from './types'

const DAY_MS = 86_400_000
const pad = (value: number) => String(value).padStart(2, '0')

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function parseIsoDate(iso: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

function toUtc(iso: IsoDate): number {
  const { year, month, day } = parseIsoDate(iso)
  return Date.UTC(year, month - 1, day)
}

function fromUtc(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(iso) + days * DAY_MS)
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

export function weekday(iso: IsoDate): number {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7
}

export function isWeekend(iso: IsoDate): boolean {
  return weekday(iso) >= 5
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthDates(year: number, month: number): IsoDate[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => toIsoDate(year, month, index + 1))
}

export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const count = daysBetween(from, to)
  return count < 0 ? [] : Array.from({ length: count + 1 }, (_, index) => addDays(from, index))
}

export function weekStart(iso: IsoDate): IsoDate {
  return addDays(iso, -weekday(iso))
}

export function isoWeekNumber(iso: IsoDate): number {
  const thursday = addDays(iso, 3 - weekday(iso))
  const { year } = parseIsoDate(thursday)
  return Math.floor(daysBetween(toIsoDate(year, 1, 1), thursday) / 7) + 1
}

export function todayIso(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}
