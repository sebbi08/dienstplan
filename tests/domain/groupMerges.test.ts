import { describe, expect, it } from 'vitest'
import { distinctGroups, groupAlreadyMerged, mergedPresent, presentNow } from '../../shared/domain/groupMerges'

const stay = (arrived: number, left: number | null) => ({ arrived, left })
const row = (childId: number, ...stays: { arrived: number; left: number | null }[]) => ({ childId, stays })

describe('present right now', () => {
  it('is a child that arrived and has not left', () => {
    expect(presentNow(row(1, stay(480, null)))).toBe(true)
    expect(presentNow(row(1, stay(480, 600), stay(700, null)))).toBe(true)
  })

  it('is not a child not yet arrived or already picked up', () => {
    expect(presentNow(row(1))).toBe(false)
    expect(presentNow(row(1, stay(480, 600)))).toBe(false)
  })
})

describe('the merged section', () => {
  const ben = row(1, stay(450, null))
  const lena = row(2)
  const mia = row(3, stay(420, 500))
  const tom = row(4, stay(470, null))

  it('keeps only the children here now, in the given (facility) order', () => {
    expect(mergedPresent([4, 3, 2, 1], [ben, lena, mia, tom]).map(child => child.childId)).toEqual([4, 1])
  })

  it('drops a child once it is picked up, takes one in once it arrives', () => {
    const later = [{ ...ben, stays: [stay(450, 900)] }, { ...lena, stays: [stay(910, null)] }, mia, tom]
    expect(mergedPresent([1, 2, 3, 4], later).map(child => child.childId)).toEqual([2, 4])
  })

  it('ignores ids not in the list and children not named in the order', () => {
    expect(mergedPresent([99, 1], [ben, tom]).map(child => child.childId)).toEqual([1])
    expect(mergedPresent([], [ben, tom])).toEqual([])
  })
})

describe('choosing the groups of a merge', () => {
  it('counts each group once', () => {
    expect(distinctGroups([3, 1, 3, 2, 1])).toEqual([3, 1, 2])
  })

  it('finds a wanted group already in an active merge', () => {
    expect(groupAlreadyMerged([[1, 2]], [3, 4])).toBeNull()
    expect(groupAlreadyMerged([[1, 2], [5, 6]], [3, 6])).toBe(6)
    expect(groupAlreadyMerged([], [1, 2])).toBeNull()
  })
})
