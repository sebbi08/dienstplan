import { dateRange } from './dates'
import { dailyTarget, employmentStart, isEmployedOn, type EmploymentInfo } from './targets'
import type { DomainEntry, IsoDate } from './types'

export interface DayResult {
  date: IsoDate
  target: number
  credit: number
  delta: number
}

export interface Totals {
  target: number
  credit: number
  delta: number
}

export interface Adjustment {
  date: IsoDate
  minutes: number
}

export type WorkSpan = Pick<DomainEntry, 'kind' | 'start' | 'end' | 'breakStart' | 'breakEnd'>

/**
 * Working minutes of one day: overlapping entries (e.g. VZ inside a full shift) count once,
 * break times (breaks of entries and additional breaks) never count.
 */
export function workedMinutes(entries: WorkSpan[]): number {
  const worked = new Uint8Array(24 * 60)
  for (const entry of entries) {
    if (entry.kind !== 'break' && entry.start !== null && entry.end !== null) worked.fill(1, entry.start, entry.end)
  }
  for (const entry of entries) {
    if (entry.kind === 'break' && entry.start !== null && entry.end !== null) worked.fill(0, entry.start, entry.end)
    else if (entry.breakStart !== null && entry.breakEnd !== null) worked.fill(0, entry.breakStart, entry.breakEnd)
  }
  return worked.reduce((sum, minute) => sum + minute, 0)
}

export function dayCredit(entries: DomainEntry[], target: number): number {
  if (entries.some(entry => entry.creditMode === 'daily_target')) return target
  return workedMinutes(entries)
}

export function computeDay(info: EmploymentInfo, date: IsoDate, entries: DomainEntry[]): DayResult {
  const target = dailyTarget(info, date)
  const credit = isEmployedOn(info, date) ? dayCredit(entries, target) : 0
  return { date, target, credit, delta: credit - target }
}

export function computeRange(info: EmploymentInfo, entries: DomainEntry[], from: IsoDate, to: IsoDate): DayResult[] {
  const byDate = new Map<IsoDate, DomainEntry[]>()
  for (const entry of entries) {
    if (entry.date < from || entry.date > to) continue
    const list = byDate.get(entry.date) ?? []
    list.push(entry)
    byDate.set(entry.date, list)
  }
  return dateRange(from, to).map(date => computeDay(info, date, byDate.get(date) ?? []))
}

export function summarize(days: DayResult[]): Totals {
  return days.reduce(
    (totals, day) => ({
      target: totals.target + day.target,
      credit: totals.credit + day.credit,
      delta: totals.delta + day.delta,
    }),
    { target: 0, credit: 0, delta: 0 },
  )
}

export function balanceUntil(
  info: EmploymentInfo, entries: DomainEntry[], adjustments: Adjustment[], until: IsoDate,
): number {
  const adjusted = adjustments.filter(a => a.date <= until).reduce((sum, a) => sum + a.minutes, 0)
  const start = employmentStart(info)
  if (start === null || start > until) return adjusted
  return adjusted + summarize(computeRange(info, entries, start, until)).delta
}
