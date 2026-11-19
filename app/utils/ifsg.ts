// The label texts are imported relative (like settingsAreas.ts); the shared domain through the alias, which the build needs.
import { weekday } from '#shared/domain/dates'
import type { IsoDate } from '#shared/domain/types'
import { de } from '../locales/de'
import { formatDayMonth } from './format'

/** A day as „Mi 25.11.“ (the earliest readmission). */
export function ifsgDayText(day: IsoDate): string {
  return `${de.weekdaysShort[weekday(day)]} ${formatDayMonth(day)}`
}

/** „frühestens ab Mi 25.11.“ with the rule's condition („… und symptomfrei“), or the text that no day can be computed. */
export function ifsgEarliestText(earliest: IsoDate | null, condition = ''): string {
  if (earliest === null) return de.ifsg.noEarliest
  return [de.ifsg.earliest(ifsgDayText(earliest)), condition].filter(Boolean).join(' ')
}
