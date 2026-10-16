import { cellKey } from '#shared/domain/cells'
import { formatDuration, formatTime } from '#shared/domain/time'
import type { Warning } from '#shared/domain/warnings'
import { de } from '~/locales/de'

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
    if (warning.type !== 'coverage' && warning.type !== 'edge') push(byCell, cellKey(warning.employeeId, warning.date), warning)
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
    case 'record_without_plan':
      return de.warnings.recordWithoutPlan(names.get(warning.employeeId) ?? '?')
  }
}
