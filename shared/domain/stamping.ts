import { breakMinutes, recordedMinutes, requiredBreakMinutes, type RecordSpan } from './timeRecords'
import type { DomainEntry } from './types'

/** Where an employee may clock in and out: own phone ("Mein Dienstplan"), the shared tablet with PIN, or both. */
export const STAMP_CHANNELS = ['both', 'phone', 'tablet'] as const
export type StampChannel = (typeof STAMP_CHANNELS)[number]

/** Whether a stamp from this source is allowed for the employee's setting ('self' = own phone/account). */
export function mayStampVia(channel: StampChannel, source: 'self' | 'terminal'): boolean {
  return channel === 'both' || (source === 'self' ? channel === 'phone' : channel === 'tablet')
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
