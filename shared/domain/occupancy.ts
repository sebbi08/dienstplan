import { addDays, daysInMonth, toIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * One entry of a child's group history. `from: null` means "since the beginning".
 * Entries with the same `from` are resolved by input order (the last one wins), so
 * callers must pass them in a deterministic order.
 */
export interface GroupEntry {
  from: IsoDate | null
  groupId: number | null
}

export interface OccupancyChild {
  id: number
  /** First day of the stay (null = no contract start, child never counts). */
  start: IsoDate | null
  /** Last day of the stay (null = open). */
  end: IsoDate | null
  /** Group history in any order. */
  groups: GroupEntry[]
}

export interface GroupStay {
  groupId: number | null
  from: IsoDate
  to: IsoDate | null
}

export interface CellEntry {
  childId: number
  from: IsoDate
  to: IsoDate | null
}

export interface OccupancyCell {
  present: CellEntry[]
  fresh: CellEntry[]
}

/**
 * Maximal continuous periods of a child in one group, clipped to `[start, end]`.
 * The group on a day is the history entry with the greatest `from` <= day (null lowest);
 * of several entries with the same date the last one given wins. Without any entry
 * valid on the first day the child is in "no group" (`null`) until the first entry.
 */
export function groupStays(child: OccupancyChild): GroupStay[] {
  const { start, end } = child
  if (start === null || isInvertedStay(start, end)) return []

  const byDate = new Map<string, GroupEntry>()
  for (const entry of child.groups) byDate.set(entry.from ?? '', entry)
  const key = (entry: GroupEntry) => entry.from ?? ''
  const entries = [...byDate.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

  let startGroup: number | null = null
  for (const entry of entries) {
    if (entry.from === null || entry.from <= start) startGroup = entry.groupId
  }

  const stays: GroupStay[] = [{ groupId: startGroup, from: start, to: end }]
  for (const entry of entries) {
    if (entry.from === null || entry.from <= start) continue
    if (end !== null && entry.from > end) continue
    const last = stays[stays.length - 1]!
    if (last.groupId === entry.groupId) continue
    last.to = addDays(entry.from, -1)
    stays.push({ groupId: entry.groupId, from: entry.from, to: end })
  }
  return stays
}

/** A stay whose end lies before its start never counts. */
function isInvertedStay(from: IsoDate, to: IsoDate | null): boolean {
  return to !== null && to < from
}

/**
 * How a stay `[from, to]` (to null = open) relates to the given month: `fresh` when
 * it starts in the month, `present` when it started earlier and still contains a day
 * of the month, else null (also for inverted stays).
 */
function classifyInMonth(from: IsoDate, to: IsoDate | null, year: number, month: number): 'fresh' | 'present' | null {
  if (isInvertedStay(from, to)) return null
  const first = toIsoDate(year, month, 1)
  const last = toIsoDate(year, month, daysInMonth(year, month))
  if (from > last || (to !== null && to < first)) return null
  return from >= first ? 'fresh' : 'present'
}

/**
 * Children counted for a group in a month: those with a group stay in the group that
 * contains at least one day of the month. `fresh` when that stay starts in the month,
 * else `present`. A child appears at most once; of several stays touching the month
 * the earliest decides. `from`/`to` are the group stay's borders.
 */
export function groupCell(children: OccupancyChild[], groupId: number | null, year: number, month: number): OccupancyCell {
  const cell: OccupancyCell = { present: [], fresh: [] }
  for (const child of children) {
    for (const stay of groupStays(child)) {
      if (stay.groupId !== groupId) continue
      const kind = classifyInMonth(stay.from, stay.to, year, month)
      if (!kind) continue
      cell[kind].push({ childId: child.id, from: stay.from, to: stay.to })
      break
    }
  }
  return cell
}

/**
 * Children counted for the whole facility in a month: each child once, `from`/`to` are
 * the whole stay's borders, `fresh` when the stay starts in the month.
 */
export function facilityCell(children: OccupancyChild[], year: number, month: number): OccupancyCell {
  const cell: OccupancyCell = { present: [], fresh: [] }
  for (const child of children) {
    if (child.start === null) continue
    const kind = classifyInMonth(child.start, child.end, year, month)
    if (kind) cell[kind].push({ childId: child.id, from: child.start, to: child.end })
  }
  return cell
}

/** Red from reaching the capacity on; `over` is the number of children above it. */
export function cellState(count: number, capacity: number | null): { red: boolean; over: number } {
  if (capacity === null) return { red: false, over: 0 }
  return { red: count >= capacity, over: Math.max(0, count - capacity) }
}
