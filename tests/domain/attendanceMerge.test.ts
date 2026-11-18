import { describe, expect, it } from 'vitest'
import { attendanceListSections } from '../../app/utils/attendanceMerge'

const BEARS = 1
const MICE = 2
const FOXES = 3

const kid = (childId: number, firstName: string, groupId: number | null, here: 'here' | 'gone' | 'not_yet') => ({
  childId, firstName, lastName: 'Kind', name: `Kind, ${firstName}`, groupId,
  stays: here === 'not_yet' ? [] : [{ arrived: 450, left: here === 'here' ? null : 600 }],
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
    expect(result.merged).toEqual([{ id: 7, groupIds: [BEARS, MICE], rows: [mo, ben], shown: [mo, ben] }])
    expect(result.groups.map(group => [group.key, ids(group.hits)])).toEqual([['3', [5]], ['none', [6]]])
  })

  it('keeps an empty merged section (nobody here yet)', () => {
    const early = children.map(child => ({ ...child, stays: [] }))
    expect(attendanceListSections(groups, [merge], early, '').merged[0]!.rows).toEqual([])
  })

  it('finds while searching also the merged groups\' children not here, in their own section, never twice', () => {
    // "B": Ben (here, in the merge) and Bea (not yet, Bären); "M": Mo (merge) and Mia (picked up, Mäuse).
    const b = attendanceListSections(groups, [merge], children, 'b')
    expect(b.merged.map(section => ids(section.shown))).toEqual([[1]])
    expect(b.groups.map(group => [group.key, ids(group.hits)])).toEqual([['1', [2]]])
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
    expect(result.merged.map(section => [section.id, ids(section.rows)])).toEqual([[7, [3, 1]], [8, []]])
    expect(result.groups.map(group => group.key)).toEqual(['none'])
  })
})
