import { cellKey, noteKey } from './cells'
import { describeCellDetailed, type DetailedEntryLike } from './describe'
import type { IsoDate } from './types'

export interface SnapshotContent {
  entries: (DetailedEntryLike & { employeeId: number; date: IsoDate })[]
  days: { date: IsoDate; info1: string; info2: string }[]
}

export interface CellDiff {
  key: string
  before: string
  after: string
}

export interface ReleasedState {
  releasedAt: string
  releasedBy: string
  cells: Map<string, string>
}

export interface ReleasedChange extends CellDiff {
  releasedAt: string
  releasedBy: string
}

/** Text per plan cell (employee × day) and per non-empty info field, as compared between releases. */
export function snapshotCells(content: SnapshotContent): Map<string, string> {
  const grouped = new Map<string, SnapshotContent['entries']>()
  for (const entry of content.entries) {
    const key = cellKey(entry.employeeId, entry.date)
    grouped.set(key, [...(grouped.get(key) ?? []), entry])
  }
  const cells = new Map<string, string>()
  for (const [key, list] of grouped) cells.set(key, describeCellDetailed(list))
  for (const day of content.days) {
    if (day.info1) cells.set(noteKey('info1', day.date), day.info1)
    if (day.info2) cells.set(noteKey('info2', day.date), day.info2)
  }
  return cells
}

function emptyValue(key: string): string {
  return key.startsWith('info') ? '' : describeCellDetailed([])
}

export function diffCells(before: Map<string, string>, after: Map<string, string>): CellDiff[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort()
  return keys.flatMap((key) => {
    const was = before.get(key) ?? emptyValue(key)
    const now = after.get(key) ?? emptyValue(key)
    return was === now ? [] : [{ key, before: was, after: now }]
  })
}

/** Every change between consecutive releases (oldest first), grouped by cell or info-field key. */
export function changeHistory(releases: ReleasedState[]): Map<string, ReleasedChange[]> {
  const history = new Map<string, ReleasedChange[]>()
  for (let index = 1; index < releases.length; index++) {
    const { releasedAt, releasedBy, cells } = releases[index]!
    for (const diff of diffCells(releases[index - 1]!.cells, cells)) {
      history.set(diff.key, [...(history.get(diff.key) ?? []), { ...diff, releasedAt, releasedBy }])
    }
  }
  return history
}
