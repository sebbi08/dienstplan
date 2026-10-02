import { dayCredit } from './balance'
import { isWeekend } from './dates'
import { isHoliday } from './holidays'
import { dailyTarget, isWorkday, type EmploymentInfo } from './targets'
import { breakRuleViolated, type RecordSpan } from './timeRecords'
import type { CodeKey, DomainEntry, IsoDate, Minutes } from './types'

export interface CoverageRule {
  id: number
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
}

export type Warning =
  | { type: 'missing_entry'; date: IsoDate; employeeId: number }
  | { type: 'coverage'; date: IsoDate; ruleId: number; label: string; found: number; required: number }
  | { type: 'target_gap'; date: IsoDate; employeeId: number; missingMinutes: number }
  | { type: 'open_record'; date: IsoDate; employeeId: number }
  | { type: 'missing_record'; date: IsoDate; employeeId: number }
  | { type: 'break_rule'; date: IsoDate; employeeId: number }
  | { type: 'record_without_plan'; date: IsoDate; employeeId: number }

export interface EmployeeDay {
  employeeId: number
  info: EmploymentInfo
  entries: DomainEntry[]
}

/** Smaller remaining times (e.g. VZ + F2 = 7:45 h of 7:48 h) are not worth a hint; the balance still counts them. */
export const TARGET_GAP_TOLERANCE_MINUTES = 15

export const TARGET_GAP_CODES: CodeKey[] = ['prep_time', 'office']

/** VZ / Büro: timed codes that may lie inside a shift and are filled up to the daily target by hand. */
export function isTargetGapCode(codeKey: CodeKey | null): boolean {
  return codeKey !== null && TARGET_GAP_CODES.includes(codeKey)
}

export function isCheckedDay(date: IsoDate, isClosureDay: boolean): boolean {
  return !isWeekend(date) && !isHoliday(date) && !isClosureDay
}

function matchesRule(entry: DomainEntry, rule: CoverageRule): boolean {
  return (entry.kind === 'shift' || entry.kind === 'special')
    && entry.start === rule.start
    && (rule.end === null || entry.end === rule.end)
}

export function dayWarnings(
  date: IsoDate, employees: EmployeeDay[], rules: CoverageRule[], isClosureDay: boolean,
): Warning[] {
  if (!isCheckedDay(date, isClosureDay)) return []
  const warnings: Warning[] = []
  const allEntries = employees.flatMap(employee => employee.entries)

  for (const rule of rules) {
    const found = allEntries.filter(entry => matchesRule(entry, rule)).length
    if (found < rule.minCount) {
      warnings.push({ type: 'coverage', date, ruleId: rule.id, label: rule.label, found, required: rule.minCount })
    }
  }

  for (const { employeeId, info, entries } of employees) {
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
export function timeWarnings(date: IsoDate, employeeId: number, entries: DomainEntry[], records: RecordSpan[]): Warning[] {
  if (entries.some(entry => entry.creditMode === 'daily_target')) return []
  const warnings: Warning[] = []
  if (records.some(record => record.end === null)) warnings.push({ type: 'open_record', date, employeeId })
  const plannedWork = entries.some(entry => entry.start !== null && entry.kind !== 'break'
    && (entry.kind !== 'code' || entry.creditMode === 'timed'))
  if (records.length === 0 && plannedWork) warnings.push({ type: 'missing_record', date, employeeId })
  if (records.length > 0 && entries.length === 0) warnings.push({ type: 'record_without_plan', date, employeeId })
  if (breakRuleViolated(records)) warnings.push({ type: 'break_rule', date, employeeId })
  return warnings
}
