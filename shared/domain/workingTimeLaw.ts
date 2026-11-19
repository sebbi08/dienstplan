import { creditsDailyTarget, isTimeOff, isWorkEntry } from './balance'
import { dayCreditedMinutes, workSpans, type BreakMode } from './stamping'
import type { RecordSpan } from './timeRecords'
import type { DomainEntry, IsoDate, Minutes } from './types'
import type { Warning } from './warnings'

/**
 * Working time law hints (Arbeitszeitgesetz), never blocking: at most 10 hours of work per day (§ 3) and at least
 * 11 hours of rest between two working days (§ 5).
 *
 * Working time is what the hours account credits as hours (balance.ts): shifts, special shifts and timed codes (VZ,
 * Büro, Arzt), home office included, without breaks (of the entries and additional ones) and without the time ranges of
 * „Überstundenfrei“; overlapping entries count once. Codes crediting the daily target (Urlaub, Krank, Fortbildung …) or
 * nothing are no hours worked, also when they have times, and whole-day entries without times count no hours. Arzt is
 * credited working time, so it counts for both rules. Stamped days use the credited time of the time tracking
 * (stamping.ts: closed records, home office and Arzt on top, automatic breaks deducted).
 */
export const MAX_DAILY_MINUTES = 10 * 60
export const MIN_REST_MINUTES = 11 * 60
const DAY = 24 * 60

export type LawEntry = Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end' | 'breakStart' | 'breakEnd'>
  & Partial<Pick<DomainEntry, 'codeKey' | 'homeOffice'>>

/** The first and last minute of work of a day ([start, end)). */
export interface WorkWindow {
  start: Minutes
  end: Minutes
}

/** Per minute of the day: 1 where planned work lies (work entries minus breaks and time off). */
function workMask(entries: LawEntry[]): Uint8Array {
  const work = new Uint8Array(DAY)
  for (const entry of entries) if (isWorkEntry(entry) && entry.end !== null) work.fill(1, entry.start!, entry.end)
  for (const entry of entries) {
    const blank = entry.kind === 'break' || isTimeOff(entry)
    if (blank && entry.start !== null && entry.end !== null) work.fill(0, entry.start, entry.end)
    else if (entry.breakStart !== null && entry.breakEnd !== null) work.fill(0, entry.breakStart, entry.breakEnd)
  }
  return work
}

/** Planned working minutes of one day for § 3 ArbZG. */
export function plannedWorkMinutes(entries: LawEntry[]): number {
  return workMask(entries).reduce((sum, minute) => sum + minute, 0)
}

/** More than 10 hours (exactly 10:00 h is allowed). */
export function exceedsMaxDaily(minutes: number): boolean {
  return minutes > MAX_DAILY_MINUTES
}

/** Planned start of the first and end of the last work of a day; null without timed work. */
export function plannedWorkWindow(entries: LawEntry[]): WorkWindow | null {
  const work = workMask(entries)
  const start = work.indexOf(1)
  return start === -1 ? null : { start, end: work.lastIndexOf(1) + 1 }
}

/** Minutes of rest from `previousEnd` on one day to `nextStart` on the next day. */
export function restMinutes(previousEnd: Minutes, nextStart: Minutes): number {
  return DAY - previousEnd + nextStart
}

/** The rest between two consecutive days when it is shorter than 11 hours (exactly 11:00 h is allowed). */
export function shortRest(
  previous: WorkWindow | null, next: WorkWindow | null,
): { from: Minutes; to: Minutes; minutes: number } | null {
  if (previous === null || next === null) return null
  const minutes = restMinutes(previous.end, next.start)
  return minutes < MIN_REST_MINUTES ? { from: previous.end, to: next.start, minutes } : null
}

/** The plan's hints of one person and day; `previousEntries` are the person's entries of the day before. */
export function plannedLawWarnings(
  date: IsoDate, employeeId: number, entries: LawEntry[], previousEntries: LawEntry[],
): Warning[] {
  const warnings: Warning[] = []
  const minutes = plannedWorkMinutes(entries)
  if (exceedsMaxDaily(minutes)) warnings.push({ type: 'max_hours', date, employeeId, minutes })
  const rest = shortRest(plannedWorkWindow(previousEntries), plannedWorkWindow(entries))
  if (rest) warnings.push({ type: 'short_rest', date, employeeId, from: rest.from, to: rest.to })
  return warnings
}

/** One stamped day: its records and planned entries (home office and Arzt count as stamped). */
export interface RecordedDay {
  entries: LawEntry[]
  records: RecordSpan[]
}

/**
 * Stamped start of the first and end of the last work of a day (closed records together with home office and Arzt);
 * null without such work or when the stamps do not count (a full-day absence or a whole Büro/home-office day).
 */
export function recordedWorkWindow(day: RecordedDay): WorkWindow | null {
  if (creditsDailyTarget(day.entries)) return null
  const spans = workSpans(day.records, day.entries)
  return spans.length === 0 ? null : { start: spans[0]!.start, end: spans.at(-1)!.end! }
}

/**
 * The time tracking's hints of one person and day (call for days of the tracking range only); `previous` is the day
 * before when it lies in the range too, otherwise null.
 */
export function recordedLawWarnings(
  date: IsoDate, employeeId: number, day: RecordedDay, breakMode: BreakMode, previous: RecordedDay | null,
): Warning[] {
  if (creditsDailyTarget(day.entries)) return []
  const warnings: Warning[] = []
  const minutes = dayCreditedMinutes(day.records, day.entries, breakMode)
  if (exceedsMaxDaily(minutes)) warnings.push({ type: 'max_hours_recorded', date, employeeId, minutes })
  const rest = shortRest(previous === null ? null : recordedWorkWindow(previous), recordedWorkWindow(day))
  if (rest) warnings.push({ type: 'short_rest_recorded', date, employeeId, from: rest.from, to: rest.to })
  return warnings
}
