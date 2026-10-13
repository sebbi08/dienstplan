import { parseIsoDate } from './dates'
import type { IsoDate } from './types'

/** Start year of the Kita year (1 September to 31 August) the date lies in. */
export function kitaYearOf(date: IsoDate): number {
  const { year, month } = parseIsoDate(date)
  return month >= 9 ? year : year - 1
}

/** `2026` -> `'2026/27'`. */
export function kitaYearLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** The twelve calendar months of a Kita year in order, September to August. */
export function kitaYearMonths(startYear: number): { year: number; month: number }[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = ((8 + index) % 12) + 1
    return { year: month >= 9 ? startYear : startYear + 1, month }
  })
}
