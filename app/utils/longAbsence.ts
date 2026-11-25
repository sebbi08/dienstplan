import type { LongAbsenceReason } from '#shared/domain/longAbsence'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** The short reason in the plan („Langzeitkrank“, „Kur/Reha“ …), or „abwesend“ for a viewer who may not see it (null). */
export function shortReasonText(reason: LongAbsenceReason | null): string {
  return reason === null ? de.longAbsence.planAbsent : de.longAbsence.shortReasons[reason]
}

/** „03.11.2026 – 15.12.2026“, or „ab 03.11.2026, bis auf Weiteres“ without an end. */
export function periodText(from: string, to: string | null): string {
  return de.longAbsence.period(formatDate(from), to === null ? null : formatDate(to))
}

/** The plan's text on the working days of a long absence without an entry, keyed by cellKey (see LongAbsencePlanDto.cells). */
export function longAbsenceCells(plan: Pick<MonthPlanDto, 'longAbsence'>): Map<string, string> {
  return new Map(Object.entries(plan.longAbsence?.cells ?? {}).map(([key, reason]) => [key, shortReasonText(reason)]))
}

/** The person is in a long absence on the date (one of the plan's periods covers it). */
export function longAbsentOn(plan: Pick<MonthPlanDto, 'longAbsence'>, employeeId: number, date: string): boolean {
  return (plan.longAbsence?.people ?? []).some(item => item.employeeId === employeeId && item.from <= date && (item.to === null || date <= item.to))
}
