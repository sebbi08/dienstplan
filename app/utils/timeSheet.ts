import type { TimeDayDto } from '#shared/types/api'

/** Same tolerance as the "Ist" marker in the plan: larger differences are highlighted. */
export const DEVIATION_MINUTES = 15

/**
 * Recorded minus planned credit for days counted from records; null where it does not apply (today, absences, before
 * start, and days marked "Im Dienst erkrankt", which count their planned time).
 */
export function recordedDifference(day: TimeDayDto): number | null {
  return day.usesRecords && !day.targetCredit && !day.sickLeave ? day.recordedMinutes - day.plannedMinutes : null
}
