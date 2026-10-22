import { dayCredit, isWorkEntry } from './balance'
import { isWeekend } from './dates'
import { isHolidayIn, type HolidayRules } from './holidays'
import { ALL_WEEKDAYS, hoursOn, isEntered, ruleAppliesOn, type OpeningHours } from './openingHours'
import { dailyTarget, isWorkday, type EmploymentInfo } from './targets'
import type { BreakMode } from './stamping'
import { breakRuleViolated, type RecordSpan } from './timeRecords'
import type { CodeKey, DomainEntry, IsoDate, Minutes } from './types'

export interface CoverageRule {
  id: number
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
  /** The group the rule applies to (null or missing = the whole facility). */
  groupId?: number | null
  /** That group's name, for the warning. */
  groupName?: string
  /** Weekdays the rule is checked on (mask Mo = 1 … Fr = 16); missing = all weekdays. */
  weekdays?: number
}

export type Warning =
  | { type: 'missing_entry'; date: IsoDate; employeeId: number }
  /** groupName only for a group rule (warnings of facility rules have no such key). */
  | { type: 'coverage'; date: IsoDate; ruleId: number; label: string; found: number; required: number; groupName?: string }
  /** Too few staff at opening / until closing; groupName only for a group with its own hours. */
  | { type: 'edge'; date: IsoDate; edge: 'opening' | 'closing'; time: Minutes; found: number; required: number; groupName?: string }
  | { type: 'target_gap'; date: IsoDate; employeeId: number; missingMinutes: number }
  | { type: 'open_record'; date: IsoDate; employeeId: number }
  | { type: 'missing_record'; date: IsoDate; employeeId: number }
  | { type: 'break_rule'; date: IsoDate; employeeId: number }
  | { type: 'record_without_plan'; date: IsoDate; employeeId: number }
  /**
   * Too few staff in a group by the state's presence rule (Personalschlüssel) during [from, to); consecutive slots
   * with the same gap are merged. `fachkraft` = too few Fachkräfte, else too few staff in total.
   */
  | {
    type: 'staffing'; date: IsoDate; groupId: number; groupName: string; from: Minutes; to: Minutes
    have: number; need: number; fachkraft: boolean
  }

export interface EmployeeDay {
  employeeId: number
  /** The home group in this facility (null = Springer, a helper of another facility, or no groups). */
  groupId: number | null
  info: EmploymentInfo
  entries: DomainEntry[]
  /** A helper of another facility: their entries count for coverage only (no missing entry, no target gap). */
  coverageOnly?: boolean
  /** The day belongs to another facility's plan (helping out there): it counts as filled; its entries are not passed. */
  busyElsewhere?: boolean
}

/** Smaller remaining times (e.g. VZ + F2 = 7:45 h of 7:48 h) are not worth a hint; the balance still counts them. */
export const TARGET_GAP_TOLERANCE_MINUTES = 15

export const TARGET_GAP_CODES: CodeKey[] = ['prep_time', 'office']

/** VZ / Büro: timed codes that may lie inside a shift and are filled up to the daily target by hand. */
export function isTargetGapCode(codeKey: CodeKey | null): boolean {
  return codeKey !== null && TARGET_GAP_CODES.includes(codeKey)
}

/** A day the plan is checked: no weekend, no public holiday of the plan's facility (its rules), no closure. */
export function isCheckedDay(date: IsoDate, isClosureDay: boolean, rules: HolidayRules): boolean {
  return !isWeekend(date) && !isHolidayIn(date, rules) && !isClosureDay
}

/** A duty that counts as staff for coverage: a shift or special shift (codes and breaks never do). */
function isDuty(entry: DomainEntry): boolean {
  return entry.kind === 'shift' || entry.kind === 'special'
}

function matchesRule(entry: DomainEntry, rule: CoverageRule): boolean {
  return isDuty(entry)
    && entry.start === rule.start
    && (rule.end === null || entry.end === rule.end)
}

/** The opening hours of a plan's facility and of those of its groups that have their own. */
export interface DayHoursContext {
  facility: OpeningHours | null
  groups: { groupId: number; groupName: string; hours: OpeningHours }[]
}

const NO_HOURS: DayHoursContext = { facility: null, groups: [] }

/** Edge warnings of one entered opening day: staff at opening (start <= open < end) and until closing (start < close <= end). */
function edgeWarnings(
  date: IsoDate, hours: OpeningHours, duties: { entry: DomainEntry; groupId: number | null }[], groupName?: string,
): Warning[] {
  const day = hoursOn(hours, date)
  if (!isEntered(day)) return []
  const spans = duties
    .filter(({ entry }) => isDuty(entry) && entry.countsAsStaff && entry.start !== null && entry.end !== null)
    .map(({ entry }) => ({ start: entry.start!, end: entry.end! }))
  const warnings: Warning[] = []
  const atOpening = spans.filter(span => span.start <= day.open && span.end > day.open).length
  if (atOpening < hours.minAtOpening) {
    warnings.push({
      type: 'edge', date, edge: 'opening', time: day.open, found: atOpening, required: hours.minAtOpening,
      ...(groupName === undefined ? {} : { groupName }),
    })
  }
  const atClosing = spans.filter(span => span.start < day.close && span.end >= day.close).length
  if (atClosing < hours.minAtClosing) {
    warnings.push({
      type: 'edge', date, edge: 'closing', time: day.close, found: atClosing, required: hours.minAtClosing,
      ...(groupName === undefined ? {} : { groupName }),
    })
  }
  return warnings
}

/**
 * Warnings of one day of a facility's plan; `holidays` are the plan facility's rules (a person's own days: their info).
 * `hours` are the opening hours: a closed weekday suppresses the coverage rules, entered ones add the edge warnings.
 */
export function dayWarnings(
  date: IsoDate, employees: EmployeeDay[], rules: CoverageRule[], isClosureDay: boolean, holidays: HolidayRules,
  hours: DayHoursContext = NO_HOURS,
): Warning[] {
  if (!isCheckedDay(date, isClosureDay, holidays)) return []
  const warnings: Warning[] = []
  // Effective group of a duty: its own group, otherwise the employee's home group (helpers have none here).
  const allEntries = employees.flatMap(employee => employee.entries
    .map(entry => ({ entry, groupId: entry.groupId ?? employee.groupId })))

  const facilityDay = hoursOn(hours.facility, date)
  for (const rule of rules) {
    if (!ruleAppliesOn(rule.weekdays ?? ALL_WEEKDAYS, date)) continue
    // A facility rule counts every duty; a group rule only those whose effective group it is.
    const groupId = rule.groupId ?? null
    // A closed weekday (the group's own day if it set one, else the facility's) is not checked.
    const ruleHours = groupId === null ? undefined : hours.groups.find(group => group.groupId === groupId)?.hours
    const groupDay = hoursOn(ruleHours ?? null, date)
    const hasOwnDay = groupDay !== null && (groupDay.closed || groupDay.open !== null || groupDay.close !== null)
    if ((hasOwnDay ? groupDay : facilityDay)?.closed) continue
    const found = allEntries
      .filter(item => matchesRule(item.entry, rule) && (groupId === null || item.groupId === groupId)).length
    if (found < rule.minCount) {
      warnings.push({
        type: 'coverage', date, ruleId: rule.id, label: rule.label, found, required: rule.minCount,
        ...(groupId === null ? {} : { groupName: rule.groupName ?? '' }),
      })
    }
  }

  // Facility: every duty of the plan (helpers included); a group with own hours: only its own duties.
  if (hours.facility !== null) warnings.push(...edgeWarnings(date, hours.facility, allEntries))
  for (const group of hours.groups) {
    warnings.push(...edgeWarnings(date, group.hours, allEntries.filter(item => item.groupId === group.groupId), group.groupName))
  }

  for (const { employeeId, info, entries, coverageOnly, busyElsewhere } of employees) {
    if (coverageOnly || busyElsewhere) continue
    // Days off of part-time staff (and days outside employment) need no entry.
    if (!isWorkday(info, date)) continue
    if (entries.length === 0) {
      warnings.push({ type: 'missing_entry', date, employeeId })
      continue
    }
    const hasGapCode = entries.some(entry => isTargetGapCode(entry.codeKey))
    if (!hasGapCode) continue
    const target = dailyTarget(info, date)
    const credit = dayCredit(entries, target)
    if (target - credit >= TARGET_GAP_TOLERANCE_MINUTES) warnings.push({ type: 'target_gap', date, employeeId, missingMinutes: target - credit })
  }

  return warnings
}

/** Hints for one past day with time tracking (call only for employed days with start date ≤ date < today). */
export function timeWarnings(
  date: IsoDate, employeeId: number, entries: DomainEntry[], records: RecordSpan[], breakMode: BreakMode = 'stamp',
): Warning[] {
  if (entries.some(entry => entry.creditMode === 'daily_target')) return []
  const warnings: Warning[] = []
  if (records.some(record => record.end === null)) warnings.push({ type: 'open_record', date, employeeId })
  const plannedWork = entries.some(isWorkEntry)
  if (records.length === 0 && plannedWork) warnings.push({ type: 'missing_record', date, employeeId })
  if (records.length > 0 && entries.length === 0) warnings.push({ type: 'record_without_plan', date, employeeId })
  // With automatic breaks the break is deducted anyway, so there is nothing to clock.
  if (breakMode === 'stamp' && breakRuleViolated(records)) warnings.push({ type: 'break_rule', date, employeeId })
  return warnings
}
