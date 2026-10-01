import type { EntryKind, IsoDate, Minutes } from './types'

export function cellKey(employeeId: number, date: IsoDate): string {
  return `${employeeId}|${date}`
}

export function parseCellKey(key: string): { employeeId: number; date: IsoDate } {
  const [employeeId, date] = key.split('|')
  return { employeeId: Number(employeeId), date: date! }
}

export function noteKey(field: 'info1' | 'info2', date: IsoDate): string {
  return `${field}|${date}`
}

/**
 * Background color for a whole plan cell: a full-day code (e.g. Krank) always colors the cell;
 * timed codes (VZ, Büro) only when the cell holds nothing but codes.
 */
export function cellFillColor<C extends string>(
  entries: { kind: EntryKind; start: Minutes | null; color: C }[],
): C | null {
  const fullDay = entries.find(entry => entry.kind === 'code' && entry.start === null)
  if (fullDay) return fullDay.color
  if (entries.length > 0 && entries.every(entry => entry.kind === 'code')) return entries[0]!.color
  return null
}
