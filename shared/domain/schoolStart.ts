import { addDays, daysInMonth, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * The school cutoff (Stichtag) as the school laws word it: of school age is who has completed `ageYears` by the end of
 * day `day` of `month` („bis zum 30. Juni das sechste Lebensjahr vollendet“).
 */
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
 * The day at whose end a child born on `birthDate` has completed `years` years of life: the day before the birthday
 * (§ 187 Abs. 2, § 188 Abs. 2 BGB), for a 29 February birthday 28 February (§ 188 Abs. 3 in common years; in leap years
 * the day before 29 February as well). It may lie in the year before the birthday (born 1 January → 31 December).
 */
function yearsCompletedOn(birthDate: IsoDate, years: number): IsoDate {
  const birth = parseIsoDate(birthDate)
  if (birth.month === 2 && birth.day === 29) return toIsoDate(birth.year + years, 2, 28)
  return addDays(toIsoDate(birth.year + years, birth.month, birth.day), -1)
}

/**
 * 1 September of the first year J in which the child has completed `ageYears` by the end of the cutoff day
 * `J-month-day`. So a child born on the day after the cutoff still belongs to that year (born 1 July, cutoff 30 June).
 * A 29 February cutoff is the last day of February in common years.
 */
export function computedSchoolStart(birthDate: IsoDate, cutoff: SchoolCutoff): IsoDate {
  const completed = yearsCompletedOn(birthDate, cutoff.ageYears)
  const year = parseIsoDate(completed).year
  const schoolYear = completed <= clampedDate(year, cutoff.month, cutoff.day) ? year : year + 1
  return toIsoDate(schoolYear, 9, 1)
}

/** The manual school start if set, else the computed one. */
export function effectiveSchoolStart(manual: IsoDate | null, birthDate: IsoDate, cutoff: SchoolCutoff): IsoDate {
  return manual ?? computedSchoolStart(birthDate, cutoff)
}
