import { de } from '~/locales/de'

/** "alle 24 Monate" for a recurring kind of mandatory appointment, "einmalig" for one that is needed once (null). */
export function intervalText(intervalMonths: number | null): string {
  return intervalMonths === null ? de.requirements.once : de.requirements.every(intervalMonths)
}
