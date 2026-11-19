import type { EmployeeListExtrasDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDateTime } from './format'

/** Colors of the small badges and texts in the employee list. */
export type ExtraTone = 'error' | 'warning' | 'neutral'

type Level = NonNullable<EmployeeListExtrasDto['level']>

/** „Stufe 4 ab 01.02.2027“, or „Endstufe“ at the top level. */
export function levelText(level: Level): string {
  return level.final ? de.employees.finalLevel : de.employees.nextLevelText(level.level, formatDate(level.on))
}

/** Red once the day has passed, amber within a month (the same limit as the former notice), else plain. */
export function levelTone(level: Level): ExtraTone {
  if (level.final) return 'neutral'
  return level.state === 'overdue' ? 'error' : level.state === 'soon' ? 'warning' : 'neutral'
}

/** The level „übernehmen“ enters: only while the step is due or overdue (null otherwise; it is entered by hand then). */
export function levelToTake(level: Level): number | null {
  return !level.final && level.state !== 'later' ? level.level : null
}

/** The day as „MM.JJJJ“ (an appointment due soon is named by its month). */
export function dueMonthYear(iso: string): string {
  return `${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** One badge per open kind: „Betriebsarzt überfällig“ and „… fehlt“ in red, „… bis 12.2026“ in amber. */
export function requirementBadge(row: EmployeeListExtrasDto['requirements'][number]): { text: string; tone: ExtraTone } {
  if (row.state === 'overdue') return { text: de.employees.requirementOverdue(row.typeName), tone: 'error' }
  if (row.state === 'missing') return { text: de.employees.requirementMissing(row.typeName), tone: 'error' }
  return { text: de.employees.requirementSoon(row.typeName, row.dueOn ? dueMonthYear(row.dueOn) : ''), tone: 'warning' }
}

/**
 * The second line under „Urlaub übrig“ during the notice window (null = nothing to show). The column follows the chosen
 * year, the notice is about one year only: the line shows only beside that year's leave.
 */
export function forfeitText(forfeit: EmployeeListExtrasDto['forfeit'], selectedYear: number): string | null {
  if (!forfeit || forfeit.year !== selectedYear) return null
  if (forfeit.status === 'read') return de.employees.forfeitRead(forfeit.readAt ? formatDateTime(forfeit.readAt).slice(0, 10) : '')
  return forfeit.status === 'open' ? de.employees.forfeitOpen : de.employees.forfeitNoAccount
}
