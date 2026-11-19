// The plan's warnings: markers per cell and per day, and their texts. The texts are imported relative so a test can load
// this file.
import { cellKey } from '#shared/domain/cells'
import { addDays, weekday } from '#shared/domain/dates'
import { formatDuration, formatTime } from '#shared/domain/time'
import type { Warning } from '#shared/domain/warnings'
import { restMinutes } from '#shared/domain/workingTimeLaw'
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
    case 'max_hours':
      return de.warnings.maxHours(names.get(warning.employeeId) ?? '?', formatDuration(warning.minutes))
    case 'max_hours_recorded':
      return de.warnings.maxHoursRecorded(names.get(warning.employeeId) ?? '?', formatDuration(warning.minutes))
    case 'short_rest':
    case 'short_rest_recorded':
      // The rest starts on the day before the warning's day.
      return de.warnings.shortRest(
        names.get(warning.employeeId) ?? '?', formatDuration(restMinutes(warning.from, warning.to)),
        formatTime(warning.from), de.weekdaysShort[weekday(addDays(warning.date, -1))]!,
        formatTime(warning.to), de.weekdaysShort[weekday(warning.date)]!,
      )
    case 'staffing':
      return de.warnings.staffing(
        warning.groupName, formatTime(warning.from), formatTime(warning.to), warning.have, warning.need, warning.fachkraft,
      )
  }
}
