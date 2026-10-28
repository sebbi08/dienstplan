import { isTimeOff, isWorkEntry } from './balance'
import type { RecordSpan } from './timeRecords'
import type { DomainEntry, Minutes } from './types'

/** "Kulanz": delays and early leaving up to this many minutes are not marked (per facility, 0–60, default 5). */
export const DEFAULT_MARK_TOLERANCE = 5
export const MIN_MARK_TOLERANCE = 0
export const MAX_MARK_TOLERANCE = 60

/** Minutes someone came late / left early on one day; null = not marked. */
export interface DayMarks {
  lateMinutes: number | null
  earlyMinutes: number | null
}

export interface MarkOptions {
  /** Only a delay of more than this many minutes is marked. */
  tolerance: number
  /** Whether early leaving is marked at all (the facility's switch). */
  markEarly: boolean
  /** The minute of the day when the day is today; missing or null for a past day. */
  now?: Minutes | null
  /**
   * The facility closed earlier that day ("Frühere Schließung") from this minute: the duty then ends at the earlier of
   * its planned end and the closing time for early leaving. Missing or null = no early closure.
   */
  closedFrom?: Minutes | null
}

export interface MarkSummary {
  lateCount: number
  lateMinutes: number
  earlyCount: number
  earlyMinutes: number
}

const NONE: DayMarks = { lateMinutes: null, earlyMinutes: null }

/**
 * Compares the stamped times of a day with its planned work (shifts, special shifts, timed codes such as VZ): the first
 * arrival with the first planned start, the last departure with the last planned end. Days without planned work or with
 * an entry crediting the daily target (Urlaub, Krank, Feiertag …) get no marks. While a stay is open nobody has left, and
 * today early leaving counts only once the planned end has passed, so a stamped break is not taken for a departure.
 * An early closure of the facility moves the planned end forward to the closing time.
 */
export function dayMarks(
  entries: (Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end'> & Partial<Pick<DomainEntry, 'codeKey'>>)[],
  records: RecordSpan[], options: MarkOptions,
): DayMarks {
  if (records.length === 0 || entries.some(entry => entry.creditMode === 'daily_target')) return NONE
  // Planned work without the time ranges of "Überstundenfrei": an ÜF at the end of the shift is where the duty ends.
  const planned = new Uint8Array(24 * 60)
  for (const entry of entries) if (isWorkEntry(entry) && entry.end !== null) planned.fill(1, entry.start!, entry.end)
  for (const entry of entries) if (isTimeOff(entry) && entry.start !== null && entry.end !== null) planned.fill(0, entry.start, entry.end)
  const plannedStart = planned.indexOf(1)
  if (plannedStart === -1) return NONE
  const dutyEnd = planned.lastIndexOf(1) + 1
  const plannedEnd = options.closedFrom === undefined || options.closedFrom === null ? dutyEnd : Math.min(dutyEnd, options.closedFrom)

  const late = Math.min(...records.map(record => record.start)) - plannedStart
  let early: number | null = null
  const departed = records.every(record => record.end !== null)
  const dayOver = options.now === undefined || options.now === null || options.now >= plannedEnd
  if (options.markEarly && departed && dayOver) early = plannedEnd - Math.max(...records.map(record => record.end!))
  return {
    lateMinutes: late > options.tolerance ? late : null,
    earlyMinutes: early !== null && early > options.tolerance ? early : null,
  }
}

/** The month's summary: how often and how many minutes in total someone came late / left early. */
export function summarizeMarks(days: DayMarks[]): MarkSummary {
  const late = days.flatMap(day => (day.lateMinutes === null ? [] : [day.lateMinutes]))
  const early = days.flatMap(day => (day.earlyMinutes === null ? [] : [day.earlyMinutes]))
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  return { lateCount: late.length, lateMinutes: sum(late), earlyCount: early.length, earlyMinutes: sum(early) }
}
