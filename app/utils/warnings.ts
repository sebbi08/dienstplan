// The plan's warnings: markers per cell and the texts of the grouped list. The texts are imported relative so a test can
// load this file.
import { cellKey } from '#shared/domain/cells'
import { parseIsoDate, weekday } from '#shared/domain/dates'
import { formatDuration, formatTime } from '#shared/domain/time'
import type { WarningFilter, WarningLine, WarningSection } from '#shared/domain/warningList'
import type { Warning } from '#shared/domain/warnings'
import type { PlanDayDto } from '#shared/types/api'
import { de } from '../locales/de'

export interface WarningIndex {
  byCell: Map<string, Warning[]>
  byDate: Map<string, Warning[]>
}

function push(map: Map<string, Warning[]>, key: string, warning: Warning) {
  map.set(key, [...(map.get(key) ?? []), warning])
}

export function indexWarnings(warnings: Warning[]): WarningIndex {
  const byCell = new Map<string, Warning[]>()
  const byDate = new Map<string, Warning[]>()
  for (const warning of warnings) {
    push(byDate, warning.date, warning)
    if (warning.type !== 'coverage' && warning.type !== 'edge' && warning.type !== 'staffing') push(byCell, cellKey(warning.employeeId, warning.date), warning)
  }
  return { byCell, byDate }
}

export function warningText(warning: Warning, names: Map<number, string>): string {
  switch (warning.type) {
    case 'missing_entry':
      return de.warnings.missingEntry(names.get(warning.employeeId) ?? '?')
    case 'coverage':
      return de.warnings.coverage(warning.label, warning.found, warning.required, warning.groupName)
    case 'edge':
      return de.warnings.edge(warning.edge, formatTime(warning.time), warning.found, warning.required, warning.groupName)
    case 'target_gap':
      return de.warnings.targetGap(names.get(warning.employeeId) ?? '?', formatDuration(warning.missingMinutes))
    case 'open_record':
      return de.warnings.openRecord(names.get(warning.employeeId) ?? '?')
    case 'missing_record':
      return de.warnings.missingRecord(names.get(warning.employeeId) ?? '?')
    case 'break_rule':
      return de.warnings.breakRule(names.get(warning.employeeId) ?? '?')
    case 'record_on_absence':
      return de.warnings.recordOnAbsence(names.get(warning.employeeId) ?? '?')
    case 'record_without_plan':
      return de.warnings.recordWithoutPlan(names.get(warning.employeeId) ?? '?')
    case 'staffing':
      return de.warnings.staffing(
        warning.groupName, formatTime(warning.from), formatTime(warning.to), warning.have, warning.need, warning.fachkraft,
      )
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Days of a line without the year: „01.–16.10.“, „28.09.–02.10.“, one day „05.10.“. */
export function daySpanText(from: string, to: string): string {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  if (from === to) return `${pad(start.day)}.${pad(start.month)}.`
  const head = start.month === end.month ? `${pad(start.day)}.` : `${pad(start.day)}.${pad(start.month)}.`
  return `${head}–${pad(end.day)}.${pad(end.month)}.`
}

/** With the weekdays: „Mo 05.–Fr 09.10.“, one day „Mo 05.10.“. */
export function weekdaySpanText(from: string, to: string): string {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  const first = `${de.weekdaysShort[weekday(from)]} ${pad(start.day)}.`
  const last = `${de.weekdaysShort[weekday(to)]} ${pad(end.day)}.${pad(end.month)}.`
  if (from === to) return last
  return `${start.month === end.month ? first : `${first}${pad(start.month)}.`}–${last}`
}

/**
 * The text of one line of the list: one day „Mo 05.10. · Anna: kein Eintrag“, a staffing gap over days
 * „Mo 05.–Fr 09.10. · Bären 7:00–8:00: 1 Fachkraft, nötig 2“, a person over days „Anna · 12 Tage ohne Eintrag (01.–16.10.)“.
 */
export function warningLineText(line: WarningLine, names: Map<number, string>): string {
  const first = line.warnings[0]!
  if (line.from !== line.to && first.type !== 'coverage' && first.type !== 'edge' && first.type !== 'staffing') {
    const name = names.get(first.employeeId) ?? '?'
    const span = daySpanText(line.from, line.to)
    switch (first.type) {
      case 'missing_entry':
        return de.warnings.missingEntryDays(name, line.days, span)
      case 'target_gap':
        return de.warnings.targetGapDays(name, line.days, formatDuration(line.missingMinutes), span)
      case 'open_record':
        return de.warnings.openRecordDays(name, line.days, span)
      case 'missing_record':
        return de.warnings.missingRecordDays(name, line.days, span)
      case 'break_rule':
        return de.warnings.breakRuleDays(name, line.days, span)
      case 'record_on_absence':
        return de.warnings.recordOnAbsenceDays(name, line.days, span)
      case 'record_without_plan':
        return de.warnings.recordWithoutPlanDays(name, line.days, span)
    }
  }
  return `${weekdaySpanText(line.from, line.to)} · ${warningText(first, names)}`
}

/** The heading's count and the summary line „Besetzung 6 · Lücken 40 · Zeiterfassung 27“: warnings not acknowledged. */
export function warningSummary(sections: WarningSection[]): { total: number; line: string } {
  return {
    total: sections.reduce((sum, section) => sum + section.count, 0),
    line: sections.map(section => `${de.warnings.categoriesShort[section.category]} ${section.count}`).join(' · '),
  }
}

/** The plan's checked days (no weekend, holiday or closure): a condensed line goes on over the others. */
export function openDaysOf(days: Pick<PlanDayDto, 'date' | 'isWeekend' | 'holidayKey' | 'closureLabel'>[]): Set<string> {
  return new Set(days.filter(day => !day.isWeekend && !day.holidayKey && !day.closureLabel).map(day => day.date))
}

const FILTER_KEY = 'dienstplan.warningFilter'
const NO_FILTER: WarningFilter = { groupId: null, employeeId: null }
const idOrNull = (value: unknown): number | null => (Number.isInteger(value) && (value as number) > 0 ? value as number : null)

/** The filter of the warning list, remembered per device (storage may be unavailable: then nothing is kept). */
export function readWarningFilter(): WarningFilter {
  try {
    const value = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null') as Partial<WarningFilter> | null
    return value && typeof value === 'object' ? { groupId: idOrNull(value.groupId), employeeId: idOrNull(value.employeeId) } : NO_FILTER
  }
  catch {
    return NO_FILTER
  }
}

export function writeWarningFilter(filter: WarningFilter): void {
  try {
    if (filter.groupId === null && filter.employeeId === null) localStorage.removeItem(FILTER_KEY)
    else localStorage.setItem(FILTER_KEY, JSON.stringify(filter))
  }
  catch {
    // Not remembered; the filter still works on this page.
  }
}
