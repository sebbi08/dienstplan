import { cellKey, noteKey } from './cells'
import { describeCellDetailed, type DetailedEntryLike } from './describe'
import type { EntryKind, IsoDate, Minutes } from './types'

export interface SnapshotContent {
  entries: (DetailedEntryLike & {
    employeeId: number
    date: IsoDate
    kind: EntryKind
    codeId: number | null
    start: Minutes | null
    end: Minutes | null
    countsAsStaff: boolean
  })[]
  days: { date: IsoDate; info1: string; info2: string }[]
}

/** What is compared between releases: a settings-independent identity plus the readable text shown to users. */
export interface CellState {
  identity: string
  text: string
}

export interface CellDiff {
  key: string
  before: string
  after: string
}

export interface ReleasedState {
  releasedAt: string
  releasedBy: string
  cells: Map<string, CellState>
}

export interface ReleasedChange extends CellDiff {
  releasedAt: string
  releasedBy: string
}

/**
 * The entries that belong to facilityId's own plan cells: drops help-elsewhere markers, i.e. entries planned in another
 * facility (helpFacilityId set and not facilityId). A missing helpFacilityId (old snapshots) counts as a home entry.
 */
export function ownEntries<T extends { helpFacilityId?: number | null }>(facilityId: number, entries: T[]): T[] {
  return entries.filter(entry => entry.helpFacilityId == null || entry.helpFacilityId === facilityId)
}

/**
 * Identity of a cell's entries that does not depend on code or template settings (labels), so renaming them is no change.
 * An entry's group (a single duty counting for another group) is part of it as a prefix before the kind; no group and a
 * missing group (snapshots from before groups) both give no prefix, so old snapshots compare as before.
 */
export function cellIdentity(entries: SnapshotContent['entries']): string {
  return entries
    .map(entry => `${entry.groupId != null ? `@${entry.groupId}|` : ''}${entry.kind}|${entry.codeId ?? ''}|${entry.start ?? ''}|${entry.end ?? ''}|${entry.breakStart ?? ''}|${entry.breakEnd ?? ''}|${entry.countsAsStaff ? 1 : 0}|${entry.note ?? ''}`)
    .join(';')
}

/**
 * Identity and text per plan cell (employee × day) and per non-empty info field, as compared between releases. With the
 * plan's group names, the texts name the group of a duty counting for another group.
 */
export function snapshotCells(content: SnapshotContent, groupNames: Record<number, string> = {}): Map<string, CellState> {
  const grouped = new Map<string, SnapshotContent['entries']>()
  for (const entry of content.entries) {
    const key = cellKey(entry.employeeId, entry.date)
    grouped.set(key, [...(grouped.get(key) ?? []), entry])
  }
  const cells = new Map<string, CellState>()
  for (const [key, list] of grouped) cells.set(key, { identity: cellIdentity(list), text: describeCellDetailed(list, groupNames) })
  for (const day of content.days) {
    if (day.info1) cells.set(noteKey('info1', day.date), { identity: day.info1, text: day.info1 })
    if (day.info2) cells.set(noteKey('info2', day.date), { identity: day.info2, text: day.info2 })
  }
  return cells
}

function emptyState(key: string): CellState {
  return { identity: '', text: key.startsWith('info') ? '' : describeCellDetailed([]) }
}

export function diffCells(before: Map<string, CellState>, after: Map<string, CellState>): CellDiff[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort()
  return keys.flatMap((key) => {
    const was = before.get(key) ?? emptyState(key)
    const now = after.get(key) ?? emptyState(key)
    return was.identity === now.identity ? [] : [{ key, before: was.text, after: now.text }]
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
