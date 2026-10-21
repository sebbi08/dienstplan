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

/**
 * The records whose times carry the day's marks: the arrival of the earliest one (late, red) and the departure of the
 * one that ends last (early, blue); null where the day has no such mark.
 */
export function markedRecords(
  day: Pick<TimeDayDto, 'lateMinutes' | 'earlyMinutes'> & { records: { id: number; start: number; end: number | null }[] },
): { lateId: number | null; earlyId: number | null } {
  // An early mark exists only when every record is closed, so an open end never wins here.
  const first = day.records.toSorted((a, b) => a.start - b.start)[0]
  const last = day.records.toSorted((a, b) => (b.end ?? Infinity) - (a.end ?? Infinity))[0]
  return {
    lateId: day.lateMinutes !== null ? first?.id ?? null : null,
    earlyId: day.earlyMinutes !== null ? last?.id ?? null : null,
  }
}
