import { describe, expect, it } from 'vitest'
import {
  cellState, facilityCell, groupCell, groupStays,
  type CellEntry, type GroupEntry, type OccupancyChild,
} from '../../shared/domain/occupancy'

const child = (
  id: number, start: string | null, end: string | null,
  groups: GroupEntry[] = [{ from: null, groupId: 1 }],
): OccupancyChild => ({ id, start, end, groups })
const ids = (cell: { present: CellEntry[]; fresh: CellEntry[] }) => ({
  present: cell.present.map(e => e.childId), fresh: cell.fresh.map(e => e.childId),
})
const mover = child(1, '2025-09-01', null, [{ from: null, groupId: 1 }, { from: '2027-03-15', groupId: 2 }])

describe('groupCell', () => {
  it('lists an entry on 15 Oct as bracket in October and main from November', () => {
    expect(ids(groupCell([child(1, '2026-10-15', null)], 1, 2026, 9))).toEqual({ present: [], fresh: [] })
    expect(ids(groupCell([child(1, '2026-10-15', null)], 1, 2026, 10))).toEqual({ present: [], fresh: [1] })
    expect(ids(groupCell([child(1, '2026-10-15', null)], 1, 2026, 11))).toEqual({ present: [1], fresh: [] })
  })

  it('counts a child leaving on 15 March in March but not in April', () => {
    expect(ids(groupCell([child(1, '2025-09-01', '2027-03-15')], 1, 2027, 3)).present).toEqual([1])
    expect(ids(groupCell([child(1, '2025-09-01', '2027-03-15')], 1, 2027, 4)).present).toEqual([])
  })

  it('splits a group change on 15 March', () => {
    expect(ids(groupCell([mover], 1, 2027, 3))).toEqual({ present: [1], fresh: [] })
    expect(ids(groupCell([mover], 1, 2027, 4))).toEqual({ present: [], fresh: [] })
    expect(ids(groupCell([mover], 2, 2027, 3))).toEqual({ present: [], fresh: [1] })
    expect(ids(groupCell([mover], 2, 2027, 4))).toEqual({ present: [1], fresh: [] })
    expect(ids(facilityCell([mover], 2027, 3))).toEqual({ present: [1], fresh: [] })
  })

  it('handles a child entering and leaving within one month', () => {
    expect(ids(groupCell([child(1, '2026-10-05', '2026-10-20')], 1, 2026, 10))).toEqual({ present: [], fresh: [1] })
    expect(ids(groupCell([child(1, '2026-10-05', '2026-10-20')], 1, 2026, 11))).toEqual({ present: [], fresh: [] })
  })

  it('handles month borders, changing back and leap February', () => {
    expect(ids(groupCell([child(1, '2026-10-31', null)], 1, 2026, 10)).fresh).toEqual([1])
    expect(ids(groupCell([child(1, '2026-09-01', '2026-10-01')], 1, 2026, 10)).present).toEqual([1])
    const back = child(1, '2025-09-01', null, [
      { from: null, groupId: 1 }, { from: '2026-01-10', groupId: 2 }, { from: '2026-05-10', groupId: 1 },
    ])
    expect(ids(groupCell([back], 1, 2026, 5))).toEqual({ present: [], fresh: [1] })
    expect(ids(groupCell([child(1, '2028-02-29', '2028-02-29')], 1, 2028, 2)).fresh).toEqual([1])
  })

  it('reports the group stay borders in the entry', () => {
    expect(groupCell([mover], 2, 2027, 4).present).toEqual([{ childId: 1, from: '2027-03-15', to: null }])
    expect(groupCell([mover], 1, 2027, 3).present).toEqual([{ childId: 1, from: '2025-09-01', to: '2027-03-14' }])
  })

  it('does not depend on the order of the history entries', () => {
    const reversed = child(1, '2025-09-01', null, [{ from: '2027-03-15', groupId: 2 }, { from: null, groupId: 1 }])
    expect(ids(groupCell([reversed], 1, 2027, 3))).toEqual({ present: [1], fresh: [] })
    expect(ids(groupCell([reversed], 2, 2027, 3))).toEqual({ present: [], fresh: [1] })
    expect(groupStays(reversed)).toEqual(groupStays(mover))
  })

  it('uses a history entry dated before the stay start as the group at the start', () => {
    const early = child(1, '2026-10-15', null, [{ from: '2020-01-01', groupId: 3 }, { from: '2026-12-01', groupId: 4 }])
    expect(ids(groupCell([early], 3, 2026, 10))).toEqual({ present: [], fresh: [1] })
    expect(ids(groupCell([early], 3, 2026, 12))).toEqual({ present: [], fresh: [] })
    expect(ids(groupCell([early], 4, 2026, 12))).toEqual({ present: [], fresh: [1] })
    expect(groupStays(early)).toEqual([
      { groupId: 3, from: '2026-10-15', to: '2026-11-30' },
      { groupId: 4, from: '2026-12-01', to: null },
    ])
  })

  it('supports the no-group bucket', () => {
    const none = child(1, '2026-10-15', null, [{ from: null, groupId: null }])
    expect(ids(groupCell([none], null, 2026, 11))).toEqual({ present: [1], fresh: [] })
    expect(ids(groupCell([none], 1, 2026, 11))).toEqual({ present: [], fresh: [] })
    expect(groupStays(child(1, '2026-10-15', null, []))).toEqual([{ groupId: null, from: '2026-10-15', to: null }])
  })

  it('lists a child once per group even with several stays touching the month', () => {
    const flip = child(1, '2026-09-01', null, [
      { from: null, groupId: 1 }, { from: '2026-10-10', groupId: 2 }, { from: '2026-10-20', groupId: 1 },
    ])
    // the earlier stay started before October: present, not fresh
    expect(ids(groupCell([flip], 1, 2026, 10))).toEqual({ present: [1], fresh: [] })
    expect(groupCell([flip], 1, 2026, 10).present[0]).toEqual({ childId: 1, from: '2026-09-01', to: '2026-10-09' })
    expect(ids(groupCell([flip], 2, 2026, 10))).toEqual({ present: [], fresh: [1] })
  })

  it('ignores history entries after the end of the stay', () => {
    const late = child(1, '2026-10-15', '2026-11-10', [{ from: null, groupId: 1 }, { from: '2026-12-01', groupId: 2 }])
    expect(groupStays(late)).toEqual([{ groupId: 1, from: '2026-10-15', to: '2026-11-10' }])
    expect(ids(groupCell([late], 2, 2026, 12))).toEqual({ present: [], fresh: [] })
  })

  it('keeps the order of the given children', () => {
    const cell = groupCell([child(2, '2025-09-01', null), child(1, '2025-09-01', null)], 1, 2026, 10)
    expect(cell.present.map(e => e.childId)).toEqual([2, 1])
  })
})

describe('groupStays', () => {
  it('is empty without a start or when the end is before the start', () => {
    expect(groupStays(child(1, null, null))).toEqual([])
    expect(groupStays(child(1, '2026-10-05', '2026-09-30'))).toEqual([])
  })

  it('keeps a one-day stay', () => {
    expect(groupStays(child(1, '2026-10-05', '2026-10-05'))).toEqual([{ groupId: 1, from: '2026-10-05', to: '2026-10-05' }])
  })

  it('merges consecutive entries of the same group', () => {
    const merged = child(1, '2025-09-01', null, [
      { from: null, groupId: 1 }, { from: '2026-01-10', groupId: 1 }, { from: '2026-05-10', groupId: 2 },
    ])
    expect(groupStays(merged)).toEqual([
      { groupId: 1, from: '2025-09-01', to: '2026-05-09' },
      { groupId: 2, from: '2026-05-10', to: null },
    ])
  })

  it('starts in the new group when a change falls on the first day of the stay', () => {
    const same = child(1, '2026-10-15', null, [{ from: null, groupId: 1 }, { from: '2026-10-15', groupId: 2 }])
    expect(groupStays(same)).toEqual([{ groupId: 2, from: '2026-10-15', to: null }])
  })

  it('lets the last of two entries with the same date win', () => {
    const dup = child(1, '2025-09-01', null, [
      { from: '2026-01-01', groupId: 2 }, { from: '2026-01-01', groupId: 3 }, { from: null, groupId: 1 },
    ])
    expect(groupStays(dup).map(s => s.groupId)).toEqual([1, 3])
  })
})

describe('facilityCell', () => {
  it('lists each child once with the whole stay borders', () => {
    const cell = facilityCell([mover, child(2, '2027-03-02', '2027-03-20')], 2027, 3)
    expect(cell.present).toEqual([{ childId: 1, from: '2025-09-01', to: null }])
    expect(cell.fresh).toEqual([{ childId: 2, from: '2027-03-02', to: '2027-03-20' }])
  })

  it('excludes children without a stay in the month', () => {
    const children = [child(1, null, null), child(2, '2027-04-01', null), child(3, '2025-09-01', '2027-02-28')]
    expect(ids(facilityCell(children, 2027, 3))).toEqual({ present: [], fresh: [] })
  })
})

describe('cellState', () => {
  it('is red from capacity on and reports the excess', () => {
    expect(cellState(20, 20)).toEqual({ red: true, over: 0 })
    expect(cellState(21, 20)).toEqual({ red: true, over: 1 })
    expect(cellState(19, 20)).toEqual({ red: false, over: 0 })
    expect(cellState(30, null)).toEqual({ red: false, over: 0 })
  })

  it('treats capacity 0 as full', () => {
    expect(cellState(0, 0)).toEqual({ red: true, over: 0 })
    expect(cellState(1, 0)).toEqual({ red: true, over: 1 })
  })
})
