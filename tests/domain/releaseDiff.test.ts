import { describe, expect, it } from 'vitest'
import { cellIdentity, changeHistory, diffCells, ownEntries, snapshotCells, type SnapshotContent } from '../../shared/domain/releaseDiff'

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
  it('includes the entry group, reading a missing group (old snapshots) like none', () => {
    const plain = entry(1, '2026-10-05', 'x', { note: 'n' })
    expect(plain).not.toHaveProperty('groupId')
    expect(cellIdentity([{ ...plain, groupId: null }])).toBe(cellIdentity([plain]))
    expect(cellIdentity([{ ...plain, groupId: null }])).toBe('code|1|||||1|n')
    expect(cellIdentity([{ ...plain, groupId: 7 }])).not.toBe(cellIdentity([plain]))
    expect(cellIdentity([{ ...plain, groupId: 7 }])).not.toBe(cellIdentity([{ ...plain, groupId: 8 }]))
    // A note can never pass for a group.
    expect(cellIdentity([{ ...plain, groupId: 7 }])).not.toBe(cellIdentity([{ ...plain, note: 'n|g7' }]))
  })
})

describe('snapshotCells with groups', () => {
  it('names an entry\'s group in the cell text when the names are given', () => {
    const content = { entries: [entry(1, '2026-10-05', 'Krank', { groupId: 3 })], days: [] }
    expect(snapshotCells(content).get('1|2026-10-05')!.text).toBe('Krank')
    expect(snapshotCells(content, { 3: 'Mäuse' }).get('1|2026-10-05')!.text).toBe('Krank → Mäuse')
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

describe('ownEntries', () => {
  it('drops entries planned in another facility, treating a missing value as a home entry', () => {
    const list = [
      { id: 1, helpFacilityId: null }, { id: 2, helpFacilityId: 2 }, { id: 3, helpFacilityId: 3 }, { id: 4 },
    ]
    expect(ownEntries(2, list).map(entry => entry.id)).toEqual([1, 2, 4])
    expect(ownEntries(1, list).map(entry => entry.id)).toEqual([1, 4])
  })
})
