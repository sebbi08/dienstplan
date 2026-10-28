import { addDays, daysInMonth, parseIsoDate, toIsoDate } from './dates'
import { MONDAY_TO_FRIDAY, workdayCount, type HoursPeriod } from './targets'
import type { IsoDate } from './types'

/**
 * Gesetzlicher Mindesturlaub (Bundesurlaubsgesetz), shown only as a hint – nothing is entered automatically and it is
 * no legal advice.
 *
 * - Full year: 24 Werktage per 6-day week (§ 3 BUrlG), so `24 * workdaysPerWeek / 6` days (5 → 20, 4 → 16, 3 → 12).
 * - Severe disability: + 5 days per 5-day week (§ 208 SGB IX), so `5 * workdaysPerWeek / 5` days more.
 * - Waiting period (§ 4 BUrlG): the full entitlement once the employment has lasted six months.
 * - 1/12 per full month of employment in the year (§ 5 (1) BUrlG), otherwise the full yearly minimum:
 *   a) joining year when the waiting period does not end in it (start after 1 July);
 *   b) leaving before the waiting period is over;
 *   c) leaving after the waiting period in the first half of the year (last day on or before 30 June).
 *   Joining and leaving in the same year follow the same rules: the full year only with the waiting period over and
 *   a last day after 30 June.
 * - Full months are counted from the start date (15 July → 15.7.–14.8. …: five by 31 December), in a later year from
 *   1 January (§§ 187 (2), 188 (2), (3) BGB).
 * - Rounding (§ 5 (2) BUrlG), only for such parts: a fraction of at least half a day becomes a full day, a smaller
 *   fraction stays (8,33 stays 8,33; 8,5 becomes 9). Base leave and the additional leave are rounded on their own.
 */
export interface StatutoryLeaveInput {
  /** Working days per week; fractions are allowed. */
  workdaysPerWeek: number
  year: number
  /** First day of employment; null = not employed (no leave). */
  employedFrom: IsoDate | null
  /** Last day of employment („ausgeschieden am“); null or missing = still employed. */
  employedUntil?: IsoDate | null
  severeDisability?: boolean
}

export interface StatutoryLeave {
  /** Days for a full year of employment (both values rounded to hundredths). */
  perYear: number
  /** Days for the asked year (fewer when joining or leaving during it, 0 when not employed in it). */
  inYear: number
}

/** Last day of the `count`-th month counted from `from` (31 January + 1 month → 28/29 February, 15 July → 14 August). */
export function monthEnd(from: IsoDate, count: number): IsoDate {
  const { year, month, day } = parseIsoDate(from)
  const index = year * 12 + (month - 1) + count
  const targetYear = Math.floor(index / 12)
  const targetMonth = (index % 12) + 1
  if (day > daysInMonth(targetYear, targetMonth)) return toIsoDate(targetYear, targetMonth, daysInMonth(targetYear, targetMonth))
  return addDays(toIsoDate(targetYear, targetMonth, day), -1)
}

/** Full months of employment from `from` up to and including `to` (at most 12). */
export function fullEmploymentMonths(from: IsoDate, to: IsoDate): number {
  let months = 0
  while (months < 12 && monthEnd(from, months + 1) <= to) months++
  return months
}

/** § 5 (2) BUrlG: a fraction of at least half a day is rounded up, a smaller one stays. */
function roundPart(days: number): number {
  const clean = Math.round(days * 1e6) / 1e6
  const whole = Math.floor(clean)
  return clean - whole >= 0.5 ? whole + 1 : clean
}

/** Shown with at most two decimals, so it is also compared that way (8,33, not 8,333…). */
const hundredths = (days: number) => Math.round(days * 100) / 100

/** Months that count in the year: 12 for the full yearly minimum, otherwise the full months of § 5 (1). */
function countingMonths(year: number, employedFrom: IsoDate, employedUntil: IsoDate | null): number {
  const yearStart = toIsoDate(year, 1, 1)
  const yearEnd = toIsoDate(year, 12, 31)
  if (employedFrom > yearEnd || (employedUntil !== null && employedUntil < yearStart)) return 0
  const waitingOver = monthEnd(employedFrom, 6)
  const leavesThisYear = employedUntil !== null && employedUntil <= yearEnd
  const joinsThisYear = employedFrom >= yearStart
  const partial
    = (joinsThisYear && waitingOver > yearEnd) // a)
      || (leavesThisYear && employedUntil! < waitingOver) // b)
      || (leavesThisYear && employedUntil! <= toIsoDate(year, 6, 30)) // c)
  if (!partial) return 12
  return fullEmploymentMonths(joinsThisYear ? employedFrom : yearStart, leavesThisYear ? employedUntil! : yearEnd)
}

function part(perYear: number, months: number): number {
  return months >= 12 ? perYear : roundPart((perYear * months) / 12)
}

export function statutoryMinimumLeave(input: StatutoryLeaveInput): StatutoryLeave {
  const base = (24 * input.workdaysPerWeek) / 6
  const extra = input.severeDisability ? (5 * input.workdaysPerWeek) / 5 : 0
  const months = input.employedFrom === null ? 0 : countingMonths(input.year, input.employedFrom, input.employedUntil ?? null)
  return { perYear: hundredths(base + extra), inYear: hundredths(part(base, months) + part(extra, months)) }
}

/** What the personnel file (employees.sensitive) says; absent when the viewer may not see it. */
export interface DisabilityInfo {
  disability: boolean
  /** „gleichgestellt“: no additional leave (§ 151 (3) SGB IX). */
  disabilityEqual: boolean
  disabilityUntil: IsoDate | null
}

/**
 * Whether the additional leave for a severe disability counts in the year: only from the personnel file block the
 * viewer was sent (without the right it is missing, so nothing about it can show through the hint), not for
 * „gleichgestellt“, and not when „gültig bis“ ends before the year.
 */
export function hasSevereDisabilityIn(sensitive: DisabilityInfo | undefined | null, year: number): boolean {
  return !!sensitive && sensitive.disability && !sensitive.disabilityEqual
    && (sensitive.disabilityUntil === null || sensitive.disabilityUntil >= `${year}-01-01`)
}

/**
 * The hint for one employee and year from the weekly-hours history: employed from the earliest „gültig ab“ until the
 * leaving day; the working days are those of the entry valid on 1 January, or on the first day for someone who joins
 * during the year (later changes in that year are not looked at).
 */
export function statutoryLeaveOf(
  employee: { hours: HoursPeriod[]; leftOn: IsoDate | null }, year: number, severeDisability: boolean,
): StatutoryLeave {
  const employedFrom = employee.hours.reduce<IsoDate | null>((min, period) => (min === null || period.validFrom < min ? period.validFrom : min), null)
  const yearStart = `${year}-01-01`
  const reference = employedFrom !== null && employedFrom > yearStart ? employedFrom : yearStart
  let valid: HoursPeriod | null = null
  for (const period of employee.hours) {
    if (period.validFrom <= reference && (!valid || period.validFrom > valid.validFrom)) valid = period
  }
  const workdaysPerWeek = workdayCount(valid?.workdays ?? MONDAY_TO_FRIDAY)
  return statutoryMinimumLeave({ workdaysPerWeek, year, employedFrom, employedUntil: employee.leftOn, severeDisability })
}
