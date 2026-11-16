import { ageOn } from '../children'
import { hoursOn, isEntered } from '../openingHours'
import type { DomainEntry, IsoDate, Minutes } from '../types'
import type { DayHoursContext } from '../warnings'
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

/** The entered opening of a group on a date: its own day if it set one, else the facility's; null = not entered. */
export function openingOn(hours: DayHoursContext, groupId: number | null, date: IsoDate): { open: Minutes; close: Minutes } | null {
  const own = groupId === null ? undefined : hours.groups.find(group => group.groupId === groupId)?.hours
  const groupDay = hoursOn(own ?? null, date)
  const hasOwnDay = groupDay !== null && (groupDay.closed || groupDay.open !== null || groupDay.close !== null)
  const day = hasOwnDay ? groupDay : hoursOn(hours.facility, date)
  return isEntered(day) ? { open: day.open, close: day.close } : null
}

/**
 * Average daily opening of a group (null = the group of no group: the facility's) on the given care days with entered
 * hours; null = none entered. The monthly report and the estimate in the group settings both use it.
 */
export function averageOpening(hours: DayHoursContext, careDays: IsoDate[], groupId: number | null): Minutes | null {
  const spans = careDays.flatMap((date) => {
    const day = openingOn(hours, groupId, date)
    return day === null ? [] : [day.close - day.open]
  })
  return spans.length === 0 ? null : spans.reduce((a, b) => a + b, 0) / spans.length
}

/**
 * Weekdays (Monday to Friday) the group is open by the opening hours that apply (its own day if it set one, else the
 * facility's): those not marked closed. null = no opening hours apply to any weekday.
 */
export function openWeekdays(hours: DayHoursContext, groupId: number | null): number | null {
  const own = groupId === null ? undefined : hours.groups.find(group => group.groupId === groupId)?.hours
  let known = 0
  let open = 0
  for (let index = 0; index < 5; index++) {
    const ownDay = own?.days[index]
    const hasOwnDay = ownDay !== undefined && (ownDay.closed || ownDay.open !== null || ownDay.close !== null)
    const day = hasOwnDay ? ownDay : hours.facility?.days[index]
    if (day === undefined) continue
    known++
    if (!day.closed) open++
  }
  return known === 0 ? null : open
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
