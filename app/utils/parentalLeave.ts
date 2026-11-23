import { parseIsoDate, weekday } from '#shared/domain/dates'
import { parentalLeaveLength } from '#shared/domain/parentalLeave'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'

const pad = (value: number) => String(value).padStart(2, '0')

/** „Mittwoch, 12. Januar 2028“: the first working day after an Elternzeit. */
export function formatWeekdayDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso)
  return `${de.weekdaysLong[weekday(iso)]}, ${pad(day)}. ${de.months[month - 1]} ${year}`
}

/** „12 Monate“, „1 Monat und 10 Tage“: the length of a period from its start to its end (both inclusive). */
export function lengthText(start: string, end: string): string {
  const { months, days } = parentalLeaveLength(start, end)
  return de.parentalLeave.lengthText(months, days)
}

/** The plan's text on the cells of a full Elternzeit („Elternzeit“ or „abwesend“), keyed by cellKey; empty without any. */
export function parentalLeaveCells(plan: Pick<MonthPlanDto, 'parentalLeave'>): Map<string, string> {
  const leave = plan.parentalLeave
  if (!leave) return new Map()
  const text = leave.label === 'parental_leave' ? de.parentalLeave.planLabel : de.parentalLeave.planAbsent
  return new Map(leave.cells.map(cell => [cell, text]))
}
