import { creditedWithoutStamping, dayCredit, isAwayCode, isFullDayTimed, isOnSite, isWorkEntry, timeOffMinutes } from './balance'
import { isWeekend } from './dates'
import { isPublicHolidayIn, type HolidayRules } from './holidays'
import type { MaternityWarning } from './maternity'
import { ALL_WEEKDAYS, hoursOn, isEntered, ruleAppliesOn, type OpeningHours } from './openingHours'
import { dailyTarget, isWorkday, type EmploymentInfo } from './targets'
import { dayBreakRuleViolated, type BreakMode } from './stamping'
import type { RecordSpan } from './timeRecords'
import type { CodeKey, DomainEntry, IsoDate, Minutes } from './types'
import type { YouthWarning } from './youthProtection'

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
  /** Too few staff at opening / until closing; groupName and groupId only for a group with its own hours. */
  | { type: 'edge'; date: IsoDate; edge: 'opening' | 'closing'; time: Minutes; found: number; required: number; groupName?: string; groupId?: number }
  | { type: 'target_gap'; date: IsoDate; employeeId: number; missingMinutes: number }
  | { type: 'open_record'; date: IsoDate; employeeId: number }
  | { type: 'missing_record'; date: IsoDate; employeeId: number }
  | { type: 'break_rule'; date: IsoDate; employeeId: number }
  | { type: 'record_without_plan'; date: IsoDate; employeeId: number }
  /** Stamped on a day whose plan is a full-day absence (Urlaub, Schließtag): the stamped time does not count. */
  | { type: 'record_on_absence'; date: IsoDate; employeeId: number }
  /** More than 10 hours of planned work on the day (§ 3 ArbZG, workingTimeLaw.ts); `minutes` worked. */
  | { type: 'max_hours'; date: IsoDate; employeeId: number; minutes: number }
  /** The same from the stamped (credited) time of a day of the time tracking. */
  | { type: 'max_hours_recorded'; date: IsoDate; employeeId: number; minutes: number }
  /** Less than 11 hours of rest from `from` on the day before to `to` on this day (§ 5 ArbZG), as planned. */
  | { type: 'short_rest'; date: IsoDate; employeeId: number; from: Minutes; to: Minutes }
  /** The same from the stamped times. */
  | { type: 'short_rest_recorded'; date: IsoDate; employeeId: number; from: Minutes; to: Minutes }
  /** More than 6 hours of planned work in a row without a break of at least 15 minutes (§ 4 Satz 3 ArbZG); not for under-18s. */
  | { type: 'long_stretch'; date: IsoDate; employeeId: number; minutes: number }
  /** More „Kind krank“ days than the entitlement of the year (§ 45 SGB V, employeeChildren.ts), `taken` counted to `date`;
   * both null for a viewer without the personal data (they tell the children and „alleinerziehend“). */
  | { type: 'child_sick_days'; date: IsoDate; employeeId: number; taken: number | null; entitlement: number | null }
  /** A working time rule of a Mutterschutz case broken (§§ 4–6 MuSchG, maternity.ts); only for viewers of the case. */
  | MaternityWarning
  /**
   * The same for a plan viewer who may not see the case: „Arbeitszeitgrenze überschritten“, one per person and day,
   * telling neither the rule nor the reason; `minutes` are the day's planned working minutes (a change shows it again).
   */
  | { type: 'work_limit'; date: IsoDate; employeeId: number; minutes: number }
  /** A rule of the Jugendarbeitsschutz broken by the plan (JArbSchG, youthProtection.ts) on a day the person is under 18. */
  | YouthWarning
  /**
   * „Geburtsjahr fehlt – Jugendarbeitsschutz kann nicht geprüft werden“: once a month (the person's first employed day of
   * it) for a trainee, student, intern or „keine pädagogische Kraft“ without a birth year; only for employees.personal.
   */
  | { type: 'youth_birth_year'; date: IsoDate; employeeId: number }
  /**
   * „Geburtstag fehlt – Jugendarbeitsschutz kann nicht sicher geprüft werden“: a birth year without a birthday in the year
   * of the 18th birthday, once a month (the first such employed day of it); only for employees.personal.
   */
  | { type: 'youth_birthday'; date: IsoDate; employeeId: number }
  /**
   * Too few staff in a group by the state's presence rule (Personalschlüssel) during [from, to); consecutive slots
   * with the same gap are merged. `fachkraft` = too few Fachkräfte, else too few staff in total.
   */
  | {
    type: 'staffing'; date: IsoDate; groupId: number; groupName: string; from: Minutes; to: Minutes
    have: number; need: number; fachkraft: boolean
  }
  /**
   * „Dienst während längerer Abwesenheit“: work is still planned on a day of an entered long absence (Langzeitkrank,
   * Kur/Reha, Sonstiges, shared/domain/longAbsence.ts); it does not count for the coverage. Tells no reason.
   */
  | { type: 'long_absence_duty'; date: IsoDate; employeeId: number }

/**
 * A long absence on the day (shared/domain/longAbsence.ts): `stored` = an entered one (Langzeitkrank, Kur/Reha,
 * Sonstiges) – the person is not expected and planned duties do not count for the coverage; `derived` = Mutterschutz
 * booked in the plan or a full Elternzeit – not expected, but a duty planned anyway (e.g. work chosen before the birth)
 * counts as before.
 */
export type LongAbsenceDay = 'stored' | 'derived'

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
  /** A long absence on the day: no „Eintrag fehlt“, no gap; see LongAbsenceDay. */
  longAbsence?: LongAbsenceDay
}

/** Smaller remaining times (e.g. VZ + F2 = 7:45 h of 7:48 h) are not worth a hint; the balance still counts them. */
export const TARGET_GAP_TOLERANCE_MINUTES = 15

export const TARGET_GAP_CODES: CodeKey[] = ['prep_time', 'office']

/** VZ / Büro: timed codes that may lie inside a shift and are filled up to the daily target by hand. */
export function isTargetGapCode(codeKey: CodeKey | null): boolean {
  return codeKey !== null && TARGET_GAP_CODES.includes(codeKey)
}

/**
 * A day the plan is checked: no weekend, no public holiday of the plan's facility (its rules), no closure. A paid free
 * 24 or 31 December (TVöD § 6 Abs. 3) is still checked: staff are freed only as far as the service allows, the Kita may
 * be open.
 */
export function isCheckedDay(date: IsoDate, isClosureDay: boolean, rules: HolidayRules): boolean {
  return !isWeekend(date) && !isPublicHolidayIn(date, rules) && !isClosureDay
}

/** A duty that counts as staff for coverage: a shift or special shift in the house (codes, breaks, home office never do). */
function isDuty(entry: DomainEntry): boolean {
  return (entry.kind === 'shift' || entry.kind === 'special') && isOnSite(entry)
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
  date: IsoDate, hours: OpeningHours, duties: { entry: DomainEntry; groupId: number | null }[], group?: { groupId: number; groupName: string },
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
      ...(group === undefined ? {} : { groupName: group.groupName, groupId: group.groupId }),
    })
  }
  const atClosing = spans.filter(span => span.start < day.close && span.end >= day.close).length
  if (atClosing < hours.minAtClosing) {
    warnings.push({
      type: 'edge', date, edge: 'closing', time: day.close, found: atClosing, required: hours.minAtClosing,
      ...(group === undefined ? {} : { groupName: group.groupName, groupId: group.groupId }),
    })
  }
  return warnings
}

/** A duty of a day with its effective group: its own group, otherwise the employee's home group (null = none). */
export interface CoverageDuty {
  entry: DomainEntry
  groupId: number | null
}

/**
 * The coverage warnings of one day: the Pflichtdienste (coverage rules on their weekdays; a closed weekday suppresses
 * them) and the staff at opening / until closing of the entered opening hours (the facility's and each group's own).
 * No holiday or closure logic: the plan calls it from dayWarnings on its checked days, the week template editor for
 * each weekday of a template (templateCoverageWarnings), so both count exactly alike.
 */
export function coverageWarnings(
  date: IsoDate, allEntries: CoverageDuty[], rules: CoverageRule[], hours: DayHoursContext = NO_HOURS,
): Warning[] {
  const warnings: Warning[] = []
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
    warnings.push(...edgeWarnings(date, group.hours, allEntries.filter(item => item.groupId === group.groupId), group))
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
  // Effective group of a duty: its own group, otherwise the employee's home group (helpers have none here). Someone in an
  // entered long absence is not there: duties still planned for them do not count.
  const allEntries = employees.filter(employee => employee.longAbsence !== 'stored').flatMap(employee => employee.entries
    .map(entry => ({ entry, groupId: entry.groupId ?? employee.groupId })))
  const warnings = coverageWarnings(date, allEntries, rules, hours)

  for (const { employeeId, info, entries, coverageOnly, busyElsewhere, longAbsence } of employees) {
    if (coverageOnly || busyElsewhere) continue
    // A long absence: nothing is missing; work still planned in an entered one is named (it does not count).
    if (longAbsence) {
      if (longAbsence === 'stored' && entries.some(isWorkEntry)) warnings.push({ type: 'long_absence_duty', date, employeeId })
      continue
    }
    // Days off of part-time staff (and days outside employment) need no entry.
    if (!isWorkday(info, date)) continue
    if (entries.length === 0) {
      warnings.push({ type: 'missing_entry', date, employeeId })
      continue
    }
    const hasGapCode = entries.some(entry => isTargetGapCode(entry.codeKey) || isAwayCode(entry.codeKey))
    if (!hasGapCode) continue
    const target = dailyTarget(info, date)
    // Hours taken off as "Überstundenfrei" are not missing: the balance pays for them.
    const missing = target - dayCredit(entries, target) - timeOffMinutes(entries)
    if (missing >= TARGET_GAP_TOLERANCE_MINUTES) warnings.push({ type: 'target_gap', date, employeeId, missingMinutes: missing })
  }

  return warnings
}

/** Hints for one past day with time tracking (call only for employed days with start date ≤ date < today). */
export function timeWarnings(
  date: IsoDate, employeeId: number, entries: DomainEntry[], records: RecordSpan[], breakMode: BreakMode = 'stamp',
): Warning[] {
  if (entries.some(entry => entry.creditMode === 'daily_target')) {
    return records.length > 0 ? [{ type: 'record_on_absence', date, employeeId }] : []
  }
  // A whole Büro or home-office day counts its target: it needs no stamp, and a stamp on it is no stamp on an absence.
  if (entries.some(isFullDayTimed)) return []
  const warnings: Warning[] = []
  if (records.some(record => record.end === null)) warnings.push({ type: 'open_record', date, employeeId })
  // Home-office entries count without stamping: only other planned work needs records.
  const plannedWork = entries.some(entry => isWorkEntry(entry) && !creditedWithoutStamping(entry))
  if (records.length === 0 && plannedWork) warnings.push({ type: 'missing_record', date, employeeId })
  if (records.length > 0 && entries.length === 0) warnings.push({ type: 'record_without_plan', date, employeeId })
  // With automatic breaks the break is deducted anyway, so there is nothing to clock. Home office counts as working time.
  if (breakMode === 'stamp' && dayBreakRuleViolated(records, entries)) warnings.push({ type: 'break_rule', date, employeeId })
  return warnings
}
