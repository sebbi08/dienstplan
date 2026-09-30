import { formatTime } from './time'
import type { EntryKind, Minutes } from './types'

export function describeEntry(
  entry: { kind: EntryKind; start: Minutes | null; end: Minutes | null }, codeLabel: string | null,
): string {
  const times = entry.start !== null && entry.end !== null ? `${formatTime(entry.start)}–${formatTime(entry.end)}` : ''
  if (entry.kind !== 'code') return times
  return times ? `${codeLabel ?? ''} ${times}`.trim() : (codeLabel ?? '')
}

export function describeCell(entries: { label: string }[]): string {
  return entries.length > 0 ? entries.map(entry => entry.label).join(' + ') : '—'
}
