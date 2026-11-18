import { describe, expect, it, vi } from 'vitest'
import { attendanceListSections, reloadAfterFailure } from '../../app/utils/attendanceMerge'

const BEARS = 1
const MICE = 2
const FOXES = 3

type Here = 'here' | 'gone' | 'not_yet' | 'sick'
const STATUS = { here: 'present', gone: 'gone', not_yet: 'not_yet', sick: 'sick' } as const
const kid = (childId: number, firstName: string, groupId: number | null, here: Here) => ({
  childId, firstName, lastName: 'Kind', name: `Kind, ${firstName}`, groupId, status: STATUS[here] as (typeof STATUS)[Here],
  stays: here === 'not_yet' || here === 'sick' ? [] : [{ arrived: 450, left: here === 'here' ? null : 600 }],
})

const ben = kid(1, 'Ben', BEARS, 'here')
const bea = kid(2, 'Bea', BEARS, 'not_yet')
const mo = kid(3, 'Mo', MICE, 'here')
const mia = kid(4, 'Mia', MICE, 'gone')
const finn = kid(5, 'Finn', FOXES, 'not_yet')
const noGroup = kid(6, 'Nils', null, 'here')
const children = [ben, bea, mo, mia, finn, noGroup]

const groups = [
  { key: '1', groupId: BEARS, name: 'Bären', rows: [ben, bea] },
  { key: '2', groupId: MICE, name: 'Mäuse', rows: [mo, mia] },
  { key: '3', groupId: FOXES, name: 'Füchse', rows: [finn] },
  { key: 'none', groupId: null, name: '', rows: [noGroup] },
]
// Mo before Ben: the facility's order across both groups.
const merge = { id: 7, groupIds: [BEARS, MICE], childIds: [3, 1, 2, 4] }
const ids = (rows: { childId: number }[]) => rows.map(row => row.childId)

describe('the day list while groups are merged', () => {
  it('lists without a merge every group as before', () => {
    const result = attendanceListSections(groups, [], children, '')
    expect(result.merged).toEqual([])
    expect(result.groups.map(group => [group.key, ids(group.hits)])).toEqual([['1', [1, 2]], ['2', [3, 4]], ['3', [5]], ['none', [6]]])
  })

  it('shows one section of the merged groups\' children here now on top, and hides those groups\' own sections', () => {
    const result = attendanceListSections(groups, [merge], children, '')
    expect(result.merged).toEqual([{ id: 7, groupIds: [BEARS, MICE], rows: [mo, ben], shown: [mo, ben], waiting: [bea] }])
    expect(result.groups.map(group => [group.key, ids(group.hits)])).toEqual([['3', [5]], ['none', [6]]])
  })

  it('keeps an empty merged section (nobody here yet)', () => {
    const early = children.map(child => ({ ...child, status: 'not_yet' as const, stays: [] }))
    const section = attendanceListSections(groups, [merge], early, '').merged[0]!
    expect(section.rows).toEqual([])
    expect(ids(section.waiting)).toEqual([3, 1, 2, 4])
  })

  it('offers below the merge its children not arrived yet, in the same order; not the picked up or absent ones', () => {
    const sina = kid(8, 'Sina', MICE, 'sick')
    const all = [...children, sina]
    const order = { ...merge, childIds: [8, 3, 1, 2, 4] }
    expect(ids(attendanceListSections(groups, [order], all, '').merged[0]!.waiting)).toEqual([2])
    // Bea arrives: she moves from „Noch nicht da“ into the merged list.
    const arrived = all.map(child => (child.childId === bea.childId
      ? { ...child, status: 'present' as const, stays: [{ arrived: 500, left: null }] }
      : child))
    const after = attendanceListSections(groups, [order], arrived, '').merged[0]!
    expect([ids(after.rows), ids(after.waiting)]).toEqual([[3, 1, 2], []])
  })

  it('finds while searching also the merged groups\' children not here, in their own section, never twice', () => {
    // "B": Ben (here, in the merge) and Bea (not yet, Bären); "M": Mo (merge) and Mia (picked up, Mäuse).
    const b = attendanceListSections(groups, [merge], children, 'b')
    expect(b.merged.map(section => [ids(section.shown), section.waiting])).toEqual([[[1], []]])
    expect(b.groups.map(group => [group.key, ids(group.hits)])).toEqual([['1', [2]]])
    // The heading counts only the group's children not in the merge above (Bea, not Ben).
    expect(b.groups.map(group => ids(group.rows))).toEqual([[2]])
    const m = attendanceListSections(groups, [merge], children, 'm')
    expect(m.merged.map(section => ids(section.shown))).toEqual([[3]])
    expect(m.groups.map(group => [group.key, ids(group.hits)])).toEqual([['2', [4]]])
  })

  it('leaves out every section without a hit while searching', () => {
    const result = attendanceListSections(groups, [merge], children, 'finn')
    expect(result.merged).toEqual([])
    expect(result.groups.map(group => group.key)).toEqual(['3'])
    expect(attendanceListSections(groups, [merge], children, 'xyz')).toEqual({ merged: [], groups: [] })
  })

  it('handles several merges at once', () => {
    const other = { id: 8, groupIds: [FOXES], childIds: [5] }
    const result = attendanceListSections(groups, [merge, other], children, '')
    expect(result.merged.map(section => [section.id, ids(section.rows), ids(section.waiting)])).toEqual([[7, [3, 1], [2]], [8, [], [5]]])
    expect(result.groups.map(group => group.key)).toEqual(['none'])
  })
})

describe('a merge or end request', () => {
  it('reloads the day data on success (by run) and when it failed', async () => {
    const reload = vi.fn(async () => {})
    expect(await reloadAfterFailure(async () => true, reload)).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    expect(await reloadAfterFailure(async () => false, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
