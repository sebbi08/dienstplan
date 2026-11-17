import { isFullDayTimed } from './balance'
import { formatTime } from './time'
import type { CreditMode, EntryKind, Minutes } from './types'

/** Ends the label of a whole Büro/VZ day (a timed code without times): „Büro (ganzer Tag)“. */
export const FULL_DAY_SUFFIX = ' (ganzer Tag)'

/**
 * The entry's label: the times; for a code its label before them. `codeCreditMode` (the code's credit mode, missing for
 * a plain marker) tells a timed code without times, the whole day: „Büro (ganzer Tag)“.
 */
export function describeEntry(
  entry: { kind: EntryKind; start: Minutes | null; end: Minutes | null }, codeLabel: string | null,
  codeCreditMode: CreditMode | null = null,
): string {
  const times = entry.start !== null && entry.end !== null ? `${formatTime(entry.start)}–${formatTime(entry.end)}` : ''
  if (entry.kind === 'break') return `[${times}]`
  if (entry.kind !== 'code') return times
  if (codeCreditMode !== null && isFullDayTimed({ ...entry, creditMode: codeCreditMode })) return `${codeLabel ?? ''}${FULL_DAY_SUFFIX}`.trim()
  return times ? `${codeLabel ?? ''} ${times}`.trim() : (codeLabel ?? '')
}

export function describeCell(entries: { label: string }[]): string {
  return entries.length > 0 ? entries.map(entry => entry.label).join(' + ') : '—'
}

export interface DetailedEntryLike {
  shortLabel: string | null
  label: string
  breakStart: Minutes | null
  breakEnd: Minutes | null
  note: string | null
  /** The group a single duty counts for (null or missing = the home group). */
  groupId?: number | null
  /** „Homeoffice – zählt ohne Stempeln“ (missing = false): the text ends in „ (Homeoffice)“. */
  homeOffice?: boolean
}

/**
 * Full cell text used to detect and show changes (includes short label, break, the group of a duty counting for another
 * group — "→ Mäuse", only when the plan passes its group names —, „ (Homeoffice)“ and note).
 */
export function describeCellDetailed(entries: DetailedEntryLike[], groupNames: Record<number, string> = {}): string {
  if (entries.length === 0) return '—'
  return entries.map((entry) => {
    const group = entry.groupId != null ? groupNames[entry.groupId] : undefined
    return (entry.shortLabel ? `${entry.shortLabel} ` : '')
      + entry.label
      + (entry.breakStart !== null && entry.breakEnd !== null
        ? ` [${formatTime(entry.breakStart)}–${formatTime(entry.breakEnd)}]`
        : '')
      + (group ? ` → ${group}` : '')
      + (entry.homeOffice ? ' (Homeoffice)' : '')
      + (entry.note ? ` · ${entry.note}` : '')
  }).join(' + ')
}
