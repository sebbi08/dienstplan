import { isFullDayTimed } from './balance'
import { breakConflict, type BreakConflict } from './breaks'
import type { DomainEntry, EntryKind } from './types'
import { isTargetGapCode } from './warnings'
import type { ColorKey } from '../types/api'

/** A week template covers Monday (0) to Sunday (6); Saturday (5) and Sunday are filled only where it has entries. */
export const TEMPLATE_WEEKDAYS = 7

/** Saturday (5) and Sunday (6) of a template. */
export const isTemplateWeekend = (weekday: number): boolean => weekday >= 5

/** The chip color of a plan or template entry: the code's color, red for a break, violet for a duty not counting as staff. */
export function planEntryColor(entry: { kind: EntryKind; countsAsStaff: boolean }, codeColor: ColorKey | null): ColorKey {
  if (entry.kind === 'code') return codeColor ?? 'neutral'
  if (entry.kind === 'break') return 'red'
  return entry.countsAsStaff ? 'neutral' : 'violet'
}

const overlaps = (a: DomainEntry, b: DomainEntry) => a.start! < b.end! && b.start! < a.end!
const isTimedWork = (entry: DomainEntry) => entry.kind !== 'break' && entry.start !== null && entry.end !== null

/**
 * The first rule one template cell (an employee's weekday) breaks, with the plan's rules: working entries do not
 * overlap each other, only VZ/Büro may lie inside a duty; every break (additional or a duty's own) lies inside a duty
 * and overlaps no other break; a whole Büro/VZ day stands alone. Null when the cell is fine.
 */
export function templateCellConflict(day: DomainEntry[]): 'entries_overlap' | BreakConflict | null {
  const timed = day.filter(isTimedWork)
  const clash = timed.some((entry, index) => timed.some((other, otherIndex) => otherIndex > index && overlaps(entry, other)
    && isTargetGapCode(entry.codeKey) === isTargetGapCode(other.codeKey)))
  if (clash) return 'entries_overlap'
  for (const entry of day) {
    const conflict = entry.kind === 'break'
      ? entry.start !== null && entry.end !== null ? breakConflict(day.filter(other => other !== entry), entry.start, entry.end) : null
      : entry.breakStart !== null && entry.breakEnd !== null
        ? breakConflict(day, entry.breakStart, entry.breakEnd, { ignoreBreakOf: entry })
        : null
    if (conflict) return conflict
  }
  // Checked last, so a break next to a whole day gets the break's text (it has no duty to lie in).
  if (day.length > 1 && day.some(isFullDayTimed)) return 'entries_overlap'
  return null
}
