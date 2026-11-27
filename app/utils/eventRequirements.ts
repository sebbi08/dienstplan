import type { PlannedRequirementDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** „geplant am 14.10.2026“, over several days „geplant vom 14.10.2026 bis 15.10.2026“. */
export function plannedText(planned: Pick<PlannedRequirementDto, 'date' | 'endDate'>): string {
  return planned.endDate === null || planned.endDate === planned.date
    ? de.eventRequirements.plannedOn(formatDate(planned.date))
    : de.eventRequirements.plannedSpan(formatDate(planned.date), formatDate(planned.endDate))
}

/** Where „Offen für dich“ confirms an appointment's attendance: the year calendar, opening its dialog. */
export function attendanceLink(attendance: { eventId: number; year: number }): string {
  return `/admin/calendar?year=${attendance.year}&attendance=${attendance.eventId}`
}
