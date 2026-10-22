import { ageOn } from '../children'
import type { DomainEntry, IsoDate, Minutes } from '../types'
import { SLOT_MINUTES } from './presence'
import type { AgeBand, Phase, StaffingRuleSet } from './types'

const DAY_MINUTES = 24 * 60
/** Minute marks of `minuteGroups`: nobody / working without a group; otherwise the group id. */
export const NOT_WORKING = -2
export const NO_GROUP = -1

/** An entry of one person's day with the group it counts for (the entry's group, else the home group; null = none). */
export type GroupedEntry = Pick<DomainEntry, 'kind' | 'creditMode' | 'start' | 'end' | 'breakStart' | 'breakEnd'> & {
  group: number | null
}

/**
 * Per minute of one person's day: the group the included entries make them work for (NOT_WORKING, NO_GROUP or the
 * group id). Breaks (break entries and the breaks of entries) never count; overlapping entries count once (the later
 * one in the list wins the minute). A day with an entry crediting the daily target (Urlaub, Krank, Fortbildung …) is
 * an absence: nothing counts. Entries `clear` names blank their minutes like a break does (the presence check: VZ or
 * Büro inside a shift is no time with the children).
 */
export function minuteGroups<T extends GroupedEntry>(
  entries: T[], include: (entry: T) => boolean, clear: (entry: T) => boolean = () => false,
): Int32Array {
  const minutes = new Int32Array(DAY_MINUTES).fill(NOT_WORKING)
  if (entries.some(entry => entry.creditMode === 'daily_target')) return minutes
  for (const entry of entries) {
    if (entry.kind === 'break' || !include(entry) || entry.start === null || entry.end === null) continue
    minutes.fill(entry.group ?? NO_GROUP, entry.start, entry.end)
  }
  for (const entry of entries) {
    const blank = entry.kind === 'break' || clear(entry)
    if (blank && entry.start !== null && entry.end !== null) minutes.fill(NOT_WORKING, entry.start, entry.end)
    else if (entry.breakStart !== null && entry.breakEnd !== null) minutes.fill(NOT_WORKING, entry.breakStart, entry.breakEnd)
  }
  return minutes
}

/** A code entry with times (VZ, Büro, …): working time perhaps, but never time with the children. */
export function isTimedCode(entry: Pick<GroupedEntry, 'kind' | 'start' | 'end'>): boolean {
  return entry.kind === 'code' && entry.start !== null && entry.end !== null
}

/** Minutes per mark (group id or NO_GROUP) of a `minuteGroups` day. */
export function minutesByGroup(minutes: Int32Array): Map<number, number> {
  const result = new Map<number, number>()
  for (const mark of minutes) if (mark !== NOT_WORKING) result.set(mark, (result.get(mark) ?? 0) + 1)
  return result
}

/** Whether the person works for `mark` during the whole slot starting at `minute` (up to `until`, e.g. the closing). */
export function worksWholeSlot(minutes: Int32Array, mark: number, minute: Minutes, until: Minutes = minute + SLOT_MINUTES): boolean {
  const end = Math.min(until, minute + SLOT_MINUTES, DAY_MINUTES)
  for (let m = minute; m < end; m++) if (minutes[m] !== mark) return false
  return true
}

/**
 * Age band on a day: `school` from the school start, `u3` before the third birthday, `ue3` in between; `ageMonths`
 * = completed months (for the rows with a finer age).
 */
export function ageBandOn(birthDate: IsoDate, schoolStart: IsoDate, date: IsoDate): { ageBand: AgeBand; ageMonths: number } {
  const { years, months } = ageOn(birthDate, date)
  const ageMonths = Math.max(0, years * 12 + months)
  if (date >= schoolStart) return { ageBand: 'school', ageMonths }
  return { ageBand: years < 3 ? 'u3' : 'ue3', ageMonths }
}

/** Weekly hours of a care type: (end − start) × days per week. */
export function weeklyHours(careType: { start: Minutes; end: Minutes; daysPerWeek: number }): number {
  return (careType.end - careType.start) / 60 * careType.daysPerWeek
}

/** A child's care time on a day overlaps the slot starting at `minute`. */
export function presentInSlot(care: { start: Minutes; end: Minutes }, minute: Minutes): boolean {
  return care.start < minute + SLOT_MINUTES && care.end > minute
}

/** Whether the state splits the day into Hauptbetreuungszeit and Randzeit (BW, NI). */
export function hasPhases(rules: StaffingRuleSet): boolean {
  return rules.presence.some(rule => rule.window !== 'always')
}

/**
 * The phase of each slot: Hauptbetreuungszeit while more than half of the group's children with a care type are
 * present by their care times, Randzeit for the rest of the opening; 'always' when the state has no such split.
 */
export function phaseOf(rules: StaffingRuleSet, cares: { start: Minutes; end: Minutes }[]): (minute: Minutes) => Phase {
  if (!hasPhases(rules)) return () => 'always'
  return minute => cares.filter(care => presentInSlot(care, minute)).length * 2 > cares.length ? 'haupt' : 'rand'
}
