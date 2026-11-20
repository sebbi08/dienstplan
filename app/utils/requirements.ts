import { de } from '~/locales/de'

/**
 * "alle 24 Monate" for a recurring kind of mandatory appointment, "einmalig" for one that is needed once (null), and
 * "der zweite nach 12 Monaten, dann alle 36 Monate" for one with a first interval (Betriebsarzt).
 */
export function intervalText(intervalMonths: number | null, firstIntervalMonths: number | null = null): string {
  if (intervalMonths === null) return de.requirements.once
  return firstIntervalMonths === null ? de.requirements.every(intervalMonths) : de.requirements.everyAfterFirst(firstIntervalMonths, intervalMonths)
}
