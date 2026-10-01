import { describe, expect, it } from 'vitest'
import { changeHistory, diffCells, snapshotCells, type SnapshotContent } from '../../shared/domain/releaseDiff'

type SnapshotEntry = SnapshotContent['entries'][number]
const entry = (employeeId: number, date: string, label: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  employeeId, date, label, shortLabel: null, breakStart: null, breakEnd: null, note: null, ...extra,
})

describe('snapshotCells', () => {
  it('describes each cell with entries and each non-empty info field', () => {
    const cells = snapshotCells({
      entries: [
        entry(1, '2026-10-05', '8:45–17:00', { shortLabel: 'S', breakStart: 730, breakEnd: 760 }),
        entry(1, '2026-10-06', 'Krank'),
      ],
      days: [
        { date: '2026-10-05', info1: 'Elternabend', info2: '' },
        { date: '2026-10-06', info1: '', info2: '' },
      ],
    })
    expect([...cells.entries()]).toEqual([
      ['1|2026-10-05', 'S 8:45–17:00 [12:10–12:40]'],
      ['1|2026-10-06', 'Krank'],
      ['info1|2026-10-05', 'Elternabend'],
    ])
  })
})

describe('diffCells', () => {
  it('reports changed, added and removed cells and info fields', () => {
    const before = new Map([['1|2026-10-05', 'Krank'], ['2|2026-10-05', 'Urlaub']])
    const after = new Map([['1|2026-10-05', 'S 8:45–17:00'], ['info1|2026-10-05', 'Fest']])
    expect(diffCells(before, after)).toEqual([
      { key: '1|2026-10-05', before: 'Krank', after: 'S 8:45–17:00' },
      { key: '2|2026-10-05', before: 'Urlaub', after: '—' },
      { key: 'info1|2026-10-05', before: '', after: 'Fest' },
    ])
  })
  it('returns nothing for identical states', () => {
    expect(diffCells(new Map([['1|a', 'X']]), new Map([['1|a', 'X']]))).toEqual([])
  })
})

describe('changeHistory', () => {
  const state = (releasedAt: string, cells: [string, string][]) => ({ releasedAt, releasedBy: 'leitung', cells: new Map(cells) })

  it('has no changes for a single release', () => {
    expect(changeHistory([state('t1', [['1|a', 'A']])]).size).toBe(0)
  })
  it('collects the changes of every later release, oldest first', () => {
    const history = changeHistory([
      state('t1', [['1|a', 'A']]),
      state('t2', [['1|a', 'B']]),
      state('t3', [['1|a', 'A'], ['info1|a', 'Fest']]),
    ])
    expect(history.get('1|a')).toEqual([
      { key: '1|a', before: 'A', after: 'B', releasedAt: 't2', releasedBy: 'leitung' },
      { key: '1|a', before: 'B', after: 'A', releasedAt: 't3', releasedBy: 'leitung' },
    ])
    expect(history.get('info1|a')).toEqual([
      { key: 'info1|a', before: '', after: 'Fest', releasedAt: 't3', releasedBy: 'leitung' },
    ])
  })
})
