import { todayIso } from '#shared/domain/dates'
import type { CalendarLeaveRequestDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** Open requests: hatched and lighter than approved leave (green Urlaub, teal Überstundenfrei). */
export const REQUEST_CLASSES: Record<CalendarLeaveRequestDto['kind'], string> = {
  vacation: 'bg-[repeating-linear-gradient(45deg,var(--color-green-100)_0_3px,var(--color-green-300)_3px_6px)]',
  overtime_off: 'bg-[repeating-linear-gradient(45deg,var(--color-teal-100)_0_3px,var(--color-teal-300)_3px_6px)]',
}

/** Where this device remembers „Anträge zeigen“ in the year calendar. */
export const SHOW_REQUESTS_KEY = 'calendar.showRequests'

/** „Anträge zeigen“ is on unless this device switched it off. */
export function showRequestsFrom(stored: string | null): boolean {
  return stored !== 'false'
}

/** Per employee id and day the open request covering it. */
export function requestCells(requests: CalendarLeaveRequestDto[]): Map<number, Map<string, CalendarLeaveRequestDto>> {
  const cells = new Map<number, Map<string, CalendarLeaveRequestDto>>()
  for (const request of requests) {
    const row = cells.get(request.employeeId) ?? new Map<string, CalendarLeaveRequestDto>()
    for (const date of request.dates) row.set(date, request)
    cells.set(request.employeeId, row)
  }
  return cells
}

/** „beantragt: Urlaub 02.11.2026 – 04.11.2026, 3 Tage, beantragt am 07.10.2026“ (tooltip, label and dialog). */
export function requestText(request: CalendarLeaveRequestDto): string {
  const period = request.startDate === request.endDate
    ? formatDate(request.startDate)
    : `${formatDate(request.startDate)} – ${formatDate(request.endDate)}`
  return de.calendar.requestText(de.leaveRequests.kinds[request.kind], period, request.workdays, formatDate(todayIso(new Date(request.createdAt))))
}
