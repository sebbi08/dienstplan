import { daysInMonth, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

export interface SchoolCutoff {
  month: number
  day: number
  ageYears: number
}

export const DEFAULT_SCHOOL_CUTOFF: SchoolCutoff = { month: 6, day: 30, ageYears: 6 }

/** Day `day` of `month`, clamped to the month length (29 February -> 28 February in non-leap years). */
function clampedDate(year: number, month: number, day: number): IsoDate {
  return toIsoDate(year, month, Math.min(day, daysInMonth(year, month)))
}

/**
 * 1 September of the first year J in which the child has reached `ageYears` on or
 * before the cutoff day `J-month-day`. A 29 February birthday counts as reached on
 * 28 February in non-leap years; a 29 February cutoff is the last day of February.
 */
export function computedSchoolStart(birthDate: IsoDate, cutoff: SchoolCutoff): IsoDate {
  const birth = parseIsoDate(birthDate)
  const reachedYear = birth.year + cutoff.ageYears
  const reached = clampedDate(reachedYear, birth.month, birth.day)
  const schoolYear = reached <= clampedDate(reachedYear, cutoff.month, cutoff.day) ? reachedYear : reachedYear + 1
  return toIsoDate(schoolYear, 9, 1)
}

/** The manual school start if set, else the computed one. */
export function effectiveSchoolStart(manual: IsoDate | null, birthDate: IsoDate, cutoff: SchoolCutoff): IsoDate {
  return manual ?? computedSchoolStart(birthDate, cutoff)
}
