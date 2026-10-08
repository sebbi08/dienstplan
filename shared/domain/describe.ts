import { formatTime } from './time'
import type { EntryKind, Minutes } from './types'

export function describeEntry(
  entry: { kind: EntryKind; start: Minutes | null; end: Minutes | null }, codeLabel: string | null,
): string {
  const times = entry.start !== null && entry.end !== null ? `${formatTime(entry.start)}–${formatTime(entry.end)}` : ''
  if (entry.kind === 'break') return `[${times}]`
  if (entry.kind !== 'code') return times
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
}

/**
 * Full cell text used to detect and show changes (includes short label, break, the group of a duty counting for another
 * group — "→ Mäuse", only when the plan passes its group names — and note).
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
      + (entry.note ? ` · ${entry.note}` : '')
  }).join(' + ')
}
