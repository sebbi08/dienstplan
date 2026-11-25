import { dateRange } from './dates'
import { balanceStart, dailyTarget, isEmployedOn, longSickOn, type EmploymentInfo } from './targets'
import type { CodeKey, DomainEntry, IsoDate } from './types'

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
export function isTimeOff(entry: Pick<DomainEntry, 'kind'> & Partial<Pick<DomainEntry, 'codeKey' | 'creditMode'>>): boolean {
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

/**
 * A whole working day without times: a timed code (Büro, VZ) entered without start and end („Büro (ganzer Tag)“, as
 * home office „Homeoffice (ganzer Tag)“). It credits the full daily target like a full-day absence, whatever was
 * stamped, needs no stamp and has no time window (so it never counts in coverage or presence windows).
 */
export function isFullDayTimed(entry: Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end'>): boolean {
  return entry.kind === 'code' && entry.creditMode === 'timed' && entry.start === null && entry.end === null
}

/** The day is credited with its daily target: a full-day absence (Urlaub, Krank …) or a full-day timed entry is planned. */
export function creditsDailyTarget(entries: Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end'>[]): boolean {
  return entries.some(entry => entry.creditMode === 'daily_target' || isFullDayTimed(entry))
}

export function dayCredit(entries: DomainEntry[], target: number): number {
  if (creditsDailyTarget(entries)) return target
  return workedMinutes(entries)
}

/** A timed entry that is working time: a shift, a special shift or a timed code (VZ, Büro); never a break or an absence. */
export function isWorkEntry(entry: Pick<DomainEntry, 'kind' | 'creditMode' | 'start'>): boolean {
  return entry.start !== null && entry.kind !== 'break' && (entry.kind !== 'code' || entry.creditMode === 'timed')
}

/** Codes that are working time but away from the house and never home office: a doctor's appointment. */
export const AWAY_CODES: CodeKey[] = ['doctor']

export function isAwayCode(codeKey: CodeKey | null | undefined): boolean {
  return !!codeKey && AWAY_CODES.includes(codeKey)
}

export function canBeHomeOffice(codeKey: CodeKey | null | undefined): boolean {
  return !isAwayCode(codeKey)
}

/**
 * Whether a planned entry puts its person in the house, there for the children: a home-office entry or an away code
 * (Arzt) never does. The one place deciding it for the coverage rules and opening/closing minimums, the
 * Personalschlüssel presence check and the monthly Ist, the day overview and the group attendance; both still count as
 * working time for the balance.
 */
export function isOnSite(entry: Pick<DomainEntry, 'homeOffice'> & Partial<Pick<DomainEntry, 'codeKey'>>): boolean {
  return entry.homeOffice !== true && !isAwayCode(entry.codeKey)
}

/**
 * Working time that counts as if it had been stamped, because the person is not at the workplace to stamp: home office
 * and away codes (Arzt). With time tracking these days are credited from the plan and need no record.
 */
export function creditedWithoutStamping(
  entry: Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end'> & Partial<Pick<DomainEntry, 'codeKey' | 'homeOffice'>>,
): boolean {
  return (entry.homeOffice === true || isAwayCode(entry.codeKey)) && isWorkEntry(entry) && entry.end !== null
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
  // Langzeitkrank and Kur/Reha (a long absence, shared/domain/longAbsence.ts): credited as a whole day „Krank“, whatever
  // is still planned or stamped, without a plan entry.
  if (isEmployedOn(info, date) && longSickOn(info, date)) credit = target
  else if (isEmployedOn(info, date)) {
    const planned = dayCredit(entries, target)
    // A full-day absence or a whole Büro/home-office day counts its target, also on days of the records.
    if (creditsDailyTarget(entries) || !usesRecords(actual, date)) {
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

/**
 * The hours account at the end of `until`: every adjustment dated until then (also one dated before „Stundenkonto ab“:
 * it is a deliberate manual booking) plus the day deltas from balanceStart on (the first weekly hours, or „Stundenkonto
 * ab“ when later).
 */
export function balanceUntil(
  info: EmploymentInfo, entries: DomainEntry[], adjustments: Adjustment[], until: IsoDate,
  actual?: ActualTime,
): number {
  const adjusted = adjustments.filter(a => a.date <= until).reduce((sum, a) => sum + a.minutes, 0)
  const start = balanceStart(info)
  if (start === null || start > until) return adjusted
  return adjusted + summarize(computeRange(info, entries, start, until, actual)).delta
}
