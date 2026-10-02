import { MONDAY_TO_FRIDAY, worksOnWeekday } from '#shared/domain/targets'
import { de } from '~/locales/de'

/** "Mo–Fr" for the usual week, otherwise the short names, e.g. "Mo, Di, Mi". */
export function workdaysText(workdays: number): string {
  if (workdays === MONDAY_TO_FRIDAY) return 'Mo–Fr'
  return de.weekdaysShort.filter((_, index) => worksOnWeekday(workdays, index)).join(', ')
}
