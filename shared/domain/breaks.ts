import type { DomainEntry, Minutes } from './types'

export type BreakConflict = 'break_outside_work' | 'break_overlap'

function overlaps(start: Minutes, end: Minutes, otherStart: Minutes, otherEnd: Minutes): boolean {
  return start < otherEnd && otherStart < end
}

/**
 * Checks a break [start, end) against the entries of its day: it must lie completely inside one timed
 * working entry and must not overlap any other break (entry breaks and additional breaks).
 * `ignoreBreakOf` skips the current break of the entry whose break is being changed.
 */
export function breakConflict(
  dayEntries: DomainEntry[], start: Minutes, end: Minutes, options: { ignoreBreakOf?: DomainEntry } = {},
): BreakConflict | null {
  const working = dayEntries.filter(entry => entry.kind !== 'break' && entry.start !== null && entry.end !== null)
  if (!working.some(entry => entry.start! <= start && end <= entry.end!)) return 'break_outside_work'

  const otherBreaks: [Minutes, Minutes][] = []
  for (const entry of dayEntries) {
    if (entry.kind === 'break' && entry.start !== null && entry.end !== null) otherBreaks.push([entry.start, entry.end])
    else if (entry !== options.ignoreBreakOf && entry.breakStart !== null && entry.breakEnd !== null) {
      otherBreaks.push([entry.breakStart, entry.breakEnd])
    }
  }
  return otherBreaks.some(([otherStart, otherEnd]) => overlaps(start, end, otherStart, otherEnd)) ? 'break_overlap' : null
}
