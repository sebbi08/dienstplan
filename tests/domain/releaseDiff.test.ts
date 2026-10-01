import { describe, expect, it } from 'vitest'
import { cellIdentity, changeHistory, diffCells, snapshotCells, type SnapshotContent } from '../../shared/domain/releaseDiff'

type SnapshotEntry = SnapshotContent['entries'][number]
const entry = (employeeId: number, date: string, label: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  employeeId, date, kind: 'code', codeId: 1, start: null, end: null, countsAsStaff: true,
  label, shortLabel: null, breakStart: null, breakEnd: null, note: null, ...extra,
})
const cell = (identity: string, text = identity) => ({ identity, text })

describe('cellIdentity', () => {
  it('is independent of labels and covers kind, code, times, break, staff flag and note', () => {
    const a = entry(1, '2026-10-05', 'Krank', { codeId: 4, start: 450, end: 600, breakStart: 500, breakEnd: 520, note: 'x' })
    const b = { ...a, label: 'Krankheit', shortLabel: 'K' }
    expect(cellIdentity([a])).toBe('code|4|450|600|500|520|1|x')
    expect(cellIdentity([b])).toBe(cellIdentity([a]))
    expect(cellIdentity([entry(1, '2026-10-05', 'x', { kind: 'shift', codeId: null, countsAsStaff: false }), a]))
      .toBe('shift||||||0|;code|4|450|600|500|520|1|x')
  })
})

describe('snapshotCells', () => {
  it('describes each cell with entries and each non-empty info field', () => {
    const cells = snapshotCells({
      entries: [
        entry(1, '2026-10-05', '8:45–17:00', { kind: 'shift', codeId: null, start: 525, end: 1020, shortLabel: 'S', breakStart: 730, breakEnd: 760 }),
        entry(1, '2026-10-06', 'Krank', { codeId: 4 }),
      ],
      days: [
        { date: '2026-10-05', info1: 'Elternabend', info2: '' },
        { date: '2026-10-06', info1: '', info2: '' },
      ],
    })
    expect([...cells.entries()]).toEqual([
      ['1|2026-10-05', { identity: 'shift||525|1020|730|760|1|', text: 'S 8:45–17:00 [12:10–12:40]' }],
      ['1|2026-10-06', { identity: 'code|4|||||1|', text: 'Krank' }],
      ['info1|2026-10-05', { identity: 'Elternabend', text: 'Elternabend' }],
    ])
  })
  it('keeps the entry order in the cell text', () => {
    const cells = snapshotCells({
      entries: [
        entry(1, '2026-10-05', 'Krank', { codeId: 4 }),
        entry(1, '2026-10-05', 'Urlaub', { codeId: 5 }),
      ],
      days: [],
    })
    expect(cells.get('1|2026-10-05')).toEqual({ identity: 'code|4|||||1|;code|5|||||1|', text: 'Krank + Urlaub' })
  })
})

describe('diffCells', () => {
  it('reports changed, added and removed cells and info fields with readable texts', () => {
    const before = new Map([['1|2026-10-05', cell('a', 'Krank')], ['2|2026-10-05', cell('b', 'Urlaub')]])
    const after = new Map([['1|2026-10-05', cell('c', 'S 8:45–17:00')], ['info1|2026-10-05', cell('Fest')]])
    expect(diffCells(before, after)).toEqual([
      { key: '1|2026-10-05', before: 'Krank', after: 'S 8:45–17:00' },
      { key: '2|2026-10-05', before: 'Urlaub', after: '—' },
      { key: 'info1|2026-10-05', before: '', after: 'Fest' },
    ])
  })
  it('returns nothing for identical states', () => {
    expect(diffCells(new Map([['1|a', cell('X')]]), new Map([['1|a', cell('X')]]))).toEqual([])
  })
  it('ignores label and short label changes when the identity is the same', () => {
    const before = new Map([['1|a', cell('code|4|||||1|', 'S Krank')]])
    const after = new Map([['1|a', cell('code|4|||||1|', 'T Krankheit')]])
    expect(diffCells(before, after)).toEqual([])
  })
  it('reports a different code with the readable texts', () => {
    const content = (codeId: number, label: string) => snapshotCells({ entries: [entry(1, '2026-10-05', label, { codeId })], days: [] })
    expect(diffCells(content(4, 'Krank'), content(5, 'Urlaub'))).toEqual([
      { key: '1|2026-10-05', before: 'Krank', after: 'Urlaub' },
    ])
  })
})

describe('changeHistory', () => {
  const state = (releasedAt: string, cells: [string, string][]) => ({
    releasedAt, releasedBy: 'leitung', cells: new Map(cells.map(([key, value]) => [key, cell(value)] as const)),
  })

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
