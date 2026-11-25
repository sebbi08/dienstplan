import { isFullDayTimed, isWorkEntry } from '#shared/domain/balance'
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

/**
 * The plan as the grid shows it: without the persons taken out of it for a long absence (a plan editor gets them sent),
 * except those shown again with „im Plan zeigen“ (`revealed`) – their columns, entries and hints. Everything else stays.
 */
export function planWithoutHidden(plan: MonthPlanDto, revealed: ReadonlySet<number> = new Set()): MonthPlanDto {
  const away = new Set((plan.longAbsence?.hidden ?? []).filter(id => !revealed.has(id)))
  if (away.size === 0) return plan
  return {
    ...plan,
    employees: plan.employees.filter(employee => !away.has(employee.id)),
    entries: plan.entries.filter(entry => !away.has(entry.employeeId)),
    admin: plan.admin && {
      ...plan.admin, warnings: plan.admin.warnings.filter(warning => !('employeeId' in warning) || !away.has(warning.employeeId)),
    },
  }
}

/**
 * The line's people for the group chosen above the plan: that group's members and the Springer (as the plan shows them
 * with a group chosen); everybody without a filter.
 */
export function longAbsencePeople(plan: Pick<MonthPlanDto, 'longAbsence'>, groupFilter: number | null) {
  const people = plan.longAbsence?.people ?? []
  return groupFilter === null ? people : people.filter(item => item.groupId === null || item.groupId === groupFilter)
}

/**
 * Who the day overview lists and counts: everybody but a person in a long absence that day – unless work is planned for
 * them; work in an entered long absence (`dutyCells`) is listed apart as not counting (`kept`), as coverage, the
 * month's „anwesend“ and the Personalschlüssel do.
 */
export function dayOverviewPeople<E extends { id: number }>(
  plan: Pick<MonthPlanDto, 'longAbsence' | 'entries'>, employees: readonly E[], date: string,
): { counted: E[]; kept: E[] } {
  const kept = new Set((plan.longAbsence?.dutyCells ?? []).filter(key => key.endsWith(`|${date}`)).map(key => Number(key.split('|')[0])))
  const works = (id: number) => plan.entries.some(entry => entry.employeeId === id && entry.date === date && (isWorkEntry(entry) || isFullDayTimed(entry)))
  const present = employees.filter(employee => !longAbsentOn(plan, employee.id, date) || works(employee.id))
  return { counted: present.filter(employee => !kept.has(employee.id)), kept: present.filter(employee => kept.has(employee.id)) }
}

/** The person is in a long absence on the date (one of the plan's periods covers it). */
export function longAbsentOn(plan: Pick<MonthPlanDto, 'longAbsence'>, employeeId: number, date: string): boolean {
  return (plan.longAbsence?.people ?? []).some(item => item.employeeId === employeeId && item.from <= date && (item.to === null || date <= item.to))
}
