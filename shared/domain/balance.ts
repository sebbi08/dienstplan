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
  & Partial<Pick<DomainEntry, 'codeKey' | 'creditMode'>>

/** The code "Überstundenfrei": a day (or a time range) off that is taken from the balance. */
export const OVERTIME_OFF = 'overtime_off'

/**
 * Time off taken from the balance: an "Überstundenfrei" entry crediting nothing (its default). With a time range only
 * those minutes are not credited, like a break: working time planned in them does not count either.
 */
export function isTimeOff(entry: WorkSpan): boolean {
  return entry.kind === 'code' && entry.codeKey === OVERTIME_OFF && entry.creditMode === 'none'
}

/** Minutes of the time ranges of time-off entries (overlaps once). */
export function timeOffMinutes(entries: WorkSpan[]): number {
  const off = new Uint8Array(24 * 60)
  for (const entry of entries) if (isTimeOff(entry) && entry.start !== null && entry.end !== null) off.fill(1, entry.start, entry.end)
  return off.reduce((sum, minute) => sum + minute, 0)
}

/**
 * Working minutes of one day: overlapping entries (e.g. VZ inside a full shift) count once,
 * break times (breaks of entries and additional breaks) and time off ("Überstundenfrei") never count.
 */
export function workedMinutes(entries: WorkSpan[]): number {
  const worked = new Uint8Array(24 * 60)
  for (const entry of entries) {
    if (entry.kind !== 'break' && !isTimeOff(entry) && entry.start !== null && entry.end !== null) worked.fill(1, entry.start, entry.end)
  }
  for (const entry of entries) {
    const blank = entry.kind === 'break' || isTimeOff(entry)
    if (blank && entry.start !== null && entry.end !== null) worked.fill(0, entry.start, entry.end)
    else if (entry.breakStart !== null && entry.breakEnd !== null) worked.fill(0, entry.breakStart, entry.breakEnd)
  }
  return worked.reduce((sum, minute) => sum + minute, 0)
}

export function dayCredit(entries: DomainEntry[], target: number): number {
  if (entries.some(entry => entry.creditMode === 'daily_target')) return target
  return workedMinutes(entries)
}

/** A timed entry that is working time: a shift, a special shift or a timed code (VZ, Büro); never a break or an absence. */
export function isWorkEntry(entry: Pick<DomainEntry, 'kind' | 'creditMode' | 'start'>): boolean {
  return entry.start !== null && entry.kind !== 'break' && (entry.kind !== 'code' || entry.creditMode === 'timed')
}

/**
 * The day has planned working time and no full-day absence (an entry crediting the daily target, e.g. Krank or
 * Urlaub): only on such a day someone can fall ill during duty ("Im Dienst erkrankt").
 */
export function hasPlannedDuty(entries: Pick<DomainEntry, 'kind' | 'creditMode' | 'start'>[]): boolean {
  return !entries.some(entry => entry.creditMode === 'daily_target') && entries.some(isWorkEntry)
}

/** Recorded time replaces the plan for days in [from, today) (Zeiterfassung). */
export interface ActualTime {
  /** First day credited from time records ("Zeiterfassung ab"). */
  from: IsoDate
  /** Today: today and later days still use the plan as forecast. */
  today: IsoDate
  /** Recorded minutes (closed records only) per date of one employee. */
  minutesByDate: Map<IsoDate, number>
  /**
   * Days credited from the plan although they lie in the range of the records ("Im Dienst erkrankt": the planned
   * working time counts in full even when less was stamped; when more was stamped, the stamped time counts).
   */
  plannedDates?: Set<IsoDate>
}

/** The day lies in the range of the time records (shown and checked against them). */
export function usesRecords(actual: ActualTime | undefined, date: IsoDate): boolean {
  return actual !== undefined && actual.from <= date && date < actual.today
}

/** The day's credit comes from the time records: a day of their range that is not credited from the plan. */
export function creditsRecords(actual: ActualTime | undefined, date: IsoDate): boolean {
  return usesRecords(actual, date) && !actual!.plannedDates?.has(date)
}

export function computeDay(info: EmploymentInfo, date: IsoDate, entries: DomainEntry[], actual?: ActualTime): DayResult {
  const target = dailyTarget(info, date)
  let credit = 0
  if (isEmployedOn(info, date)) {
    const planned = dayCredit(entries, target)
    if (entries.some(entry => entry.creditMode === 'daily_target') || !usesRecords(actual, date)) {
      credit = planned
    }
    else {
      const recorded = actual!.minutesByDate.get(date) ?? 0
      // "Im Dienst erkrankt": the plan counts in full, but never less than was actually recorded.
      credit = creditsRecords(actual, date) ? recorded : Math.max(planned, recorded)
    }
  }
  return { date, target, credit, delta: credit - target }
}

export function computeRange(
  info: EmploymentInfo, entries: DomainEntry[], from: IsoDate, to: IsoDate, actual?: ActualTime,
): DayResult[] {
  const byDate = new Map<IsoDate, DomainEntry[]>()
  for (const entry of entries) {
    if (entry.date < from || entry.date > to) continue
    const list = byDate.get(entry.date) ?? []
    list.push(entry)
    byDate.set(entry.date, list)
  }
  return dateRange(from, to).map(date => computeDay(info, date, byDate.get(date) ?? [], actual))
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
  actual?: ActualTime,
): number {
  const adjusted = adjustments.filter(a => a.date <= until).reduce((sum, a) => sum + a.minutes, 0)
  const start = employmentStart(info)
  if (start === null || start > until) return adjusted
  return adjusted + summarize(computeRange(info, entries, start, until, actual)).delta
}
