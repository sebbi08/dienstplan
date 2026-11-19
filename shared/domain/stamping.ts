import { creditedWithoutStamping, isTimeOff } from './balance'
import { breakMinutes, recordedMinutes, requiredBreakMinutes, type RecordSpan } from './timeRecords'
import type { DomainEntry } from './types'

/** Where an employee may clock in and out: the shared tablet with PIN always; 'both' also allows the own phone ("Mein Dienstplan"). */
export const STAMP_CHANNELS = ['both', 'tablet'] as const
export type StampChannel = (typeof STAMP_CHANNELS)[number]

/** Whether a stamp from this source is allowed for the employee's setting ('self' = own phone; the tablet is always allowed). */
export function mayStampVia(channel: StampChannel, source: 'self' | 'terminal'): boolean {
  return source === 'terminal' || channel === 'both'
}

/** 'stamp': breaks are clocked out and in; 'auto': the break is deducted in full without clocking it. */
export const BREAK_MODES = ['stamp', 'auto'] as const
export type BreakMode = (typeof BREAK_MODES)[number]

/** Minutes of planned breaks on one day: the breaks of shifts plus additional break entries. */
export function plannedBreakMinutes(entries: Pick<DomainEntry, 'kind' | 'start' | 'end' | 'breakStart' | 'breakEnd'>[]): number {
  return entries.reduce((sum, entry) => {
    if (entry.kind === 'break') return sum + (entry.start !== null && entry.end !== null ? entry.end - entry.start : 0)
    return sum + (entry.breakStart !== null && entry.breakEnd !== null ? entry.breakEnd - entry.breakStart : 0)
  }, 0)
}

/**
 * Worked minutes credited for one day of clocked records. With 'stamp' that is the clocked time (gaps are breaks).
 * With 'auto' the planned break (or, without a planned one, the legal minimum) is deducted in full; breaks that were
 * clocked anyway count towards it, so nothing is deducted twice.
 */
export function creditedMinutes(records: RecordSpan[], mode: BreakMode, plannedBreak: number): number {
  const recorded = recordedMinutes(records)
  if (mode === 'stamp' || recorded === 0) return recorded
  const due = plannedBreak > 0 ? plannedBreak : requiredBreakMinutes(recorded)
  return Math.max(0, recorded - Math.max(0, due - breakMinutes(records)))
}

type DayEntry = Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end' | 'breakStart' | 'breakEnd'>
  & Partial<Pick<DomainEntry, 'codeKey' | 'homeOffice'>>

/** „Homeoffice – zählt ohne Stempeln“ and Arzt: an entry with working time whose time counts as if it had been stamped. */
export function isHomeOffice(entry: DayEntry): boolean {
  return creditedWithoutStamping(entry)
}

/**
 * Minutes of the day's home-office entries that count on top of the clocked records: planned breaks (of the entries,
 * additional breaks, time off) are not counted, as in workedMinutes; minutes also covered by a closed record count
 * there only (once).
 */
export function homeOfficeMinutes(entries: DayEntry[], records: RecordSpan[]): number {
  const home = homeOfficeMask(entries)
  for (const record of records) if (record.end !== null) home.fill(0, record.start, record.end)
  return home.reduce((sum, minute) => sum + minute, 0)
}

/** Per minute of the day: 1 where a home-office entry counts (its planned breaks and time off left out). */
function homeOfficeMask(entries: DayEntry[]): Uint8Array {
  const home = new Uint8Array(24 * 60)
  for (const entry of entries) if (isHomeOffice(entry)) home.fill(1, entry.start!, entry.end!)
  for (const entry of entries) {
    const blank = entry.kind === 'break' || isTimeOff(entry)
    if (blank && entry.start !== null && entry.end !== null) home.fill(0, entry.start, entry.end)
    else if (entry.breakStart !== null && entry.breakEnd !== null) home.fill(0, entry.breakStart, entry.breakEnd)
  }
  return home
}

/**
 * The day's working time as spans: the closed records together with the home-office minutes (union). Its gaps are the
 * breaks taken (breakMinutes counts those of at least 15 minutes); without home office it is the closed records. Also
 * the stamped working time of the rest period hint (workingTimeLaw.ts).
 */
export function workSpans(records: RecordSpan[], entries: DayEntry[]): RecordSpan[] {
  const work = homeOfficeMask(entries)
  for (const record of records) if (record.end !== null) work.fill(1, record.start, record.end)
  const spans: RecordSpan[] = []
  for (let minute = 0; minute < work.length; minute++) {
    if (work[minute] !== 1) continue
    const start = minute
    while (minute < work.length && work[minute] === 1) minute++
    spans.push({ start, end: minute })
  }
  return spans
}

/**
 * What one day of the time tracking credits: the clocked records (creditedMinutes, with the planned breaks outside the
 * home office) plus the home-office minutes outside them. With automatic breaks the legal minimum break (§ 4 ArbZG)
 * follows the whole working time of the day (clocked + home office): what the breaks taken (gaps of the union, the
 * deducted break) leave missing is deducted as well. Without home-office entries it is creditedMinutes as before.
 */
export function dayCreditedMinutes(records: RecordSpan[], entries: DayEntry[], mode: BreakMode): number {
  const home = entries.filter(isHomeOffice)
  // A break entry inside a home-office entry is deducted from the home office, not a second time from the clocked part.
  const insideHome = (entry: DayEntry) => entry.kind === 'break' && entry.start !== null && entry.end !== null
    && home.some(other => other.start! <= entry.start! && entry.end! <= other.end!)
  const plannedBreak = plannedBreakMinutes(entries.filter(entry => !isHomeOffice(entry) && !insideHome(entry)))
  const clocked = creditedMinutes(records, mode, plannedBreak)
  const homeMinutes = homeOfficeMinutes(entries, records)
  if (mode === 'stamp' || homeMinutes === 0) return clocked + homeMinutes
  const recorded = recordedMinutes(records)
  const taken = breakMinutes(workSpans(records, entries)) + (recorded - clocked)
  const missing = requiredBreakMinutes(recorded + homeMinutes) - taken
  return clocked + homeMinutes - Math.max(0, missing)
}

/** The legal break hint (stamped breaks): the breaks taken against the whole working time, clocked + home office. */
export function dayBreakRuleViolated(records: RecordSpan[], entries: DayEntry[]): boolean {
  return breakMinutes(workSpans(records, entries)) < requiredBreakMinutes(recordedMinutes(records) + homeOfficeMinutes(entries, records))
}

/**
 * „Erfasst“ of a day on the time pages: the clocked minutes, plus the home office counting as stamped – only on days of
 * the tracking range (`inRange` = usesRecords); outside it the day shows the plan as before.
 */
export function recordedDay(
  records: RecordSpan[], entries: DayEntry[], inRange: boolean,
): { homeOffice: { start: number; end: number; away?: true }[]; recordedMinutes: number } {
  if (!inRange) return { homeOffice: [], recordedMinutes: recordedMinutes(records) }
  return {
    // Home office and away codes (Arzt, marked `away`) counting as stamped: one line each.
    homeOffice: entries.filter(isHomeOffice).map(entry => ({
      start: entry.start!, end: entry.end!, ...(entry.homeOffice === true ? {} : { away: true as const }),
    })),
    recordedMinutes: recordedMinutes(records) + homeOfficeMinutes(entries, records),
  }
}
