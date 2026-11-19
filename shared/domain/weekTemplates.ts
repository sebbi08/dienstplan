import { isFullDayTimed } from './balance'
import { breakConflict, type BreakConflict } from './breaks'
import { addDays } from './dates'
import type { DomainEntry, EntryKind, IsoDate } from './types'
import { coverageWarnings, isTargetGapCode, type CoverageRule, type DayHoursContext, type Warning } from './warnings'
import type { ColorKey } from '../types/api'

/** A week template covers Monday (0) to Sunday (6); Saturday (5) and Sunday are filled only where it has entries. */
export const TEMPLATE_WEEKDAYS = 7

/** Longest Info 1 / Info 2 text of a template weekday: as long as the plan's info fields (dayNoteSchema). */
export const TEMPLATE_INFO_MAX = 200

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

/** A template entry for its coverage check: a plan entry without a date, on its weekday (0 = Monday … 6 = Sunday). */
export type TemplateCoverageEntry = DomainEntry & { weekday: number }

/** A week of no meaning of its own (2024-01-08 is a Monday) whose days stand for a template's weekdays in the checks. */
const REFERENCE_MONDAY: IsoDate = '2024-01-08'

/** The date a template weekday is checked on (its warnings carry it). */
export const templateWeekdayDate = (weekday: number): IsoDate => addDays(REFERENCE_MONDAY, weekday)

/**
 * The Pflichtdienste and the staff at opening / until closing of a template, per weekday, counted exactly like a plan
 * day (coverageWarnings: on-site duties only, home office and Arzt never; a closed weekday skipped; Saturday and Sunday
 * only where the opening hours and rules have them). No holiday logic: a template has no dates. A duty counts for the
 * person's home group (`homeGroupOf`; a template entry has no group of its own). A group template (`groupId`) holds
 * only that group's duties, so it gets only that group's warnings (its Pflichtdienste and its own opening hours).
 */
export function templateCoverageWarnings(
  entries: TemplateCoverageEntry[], homeGroupOf: (employeeId: number) => number | null, rules: CoverageRule[],
  hours: DayHoursContext, groupId: number | null = null,
): { weekday: number; warning: Warning }[] {
  const ruleGroup = new Map(rules.map(rule => [rule.id, rule.groupId ?? null]))
  const ofScope = (warning: Warning) => groupId === null
    || (warning.type === 'coverage' && ruleGroup.get(warning.ruleId) === groupId)
    || (warning.type === 'edge' && warning.groupId === groupId)
  return Array.from({ length: TEMPLATE_WEEKDAYS }, (_, weekday) => {
    const duties = entries.filter(entry => entry.weekday === weekday)
      .map(entry => ({ entry, groupId: entry.groupId ?? homeGroupOf(entry.employeeId) }))
    return coverageWarnings(templateWeekdayDate(weekday), duties, rules, hours).filter(ofScope)
      .map(warning => ({ weekday, warning }))
  }).flat()
}
