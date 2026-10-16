import { describe, expect, it } from 'vitest'
import { groupRight } from '../../shared/domain/groupAccess'

describe('groupRight', () => {
  const access = { own: 1, readable: [2, 3] }

  it('lets a viewer without group access write in every group', () => {
    expect(groupRight(1, null)).toBe('write')
    expect(groupRight(7, null)).toBe('write')
    expect(groupRight(null, null)).toBe('write')
  })

  it('lets everyone write for a child without group', () => {
    expect(groupRight(null, access)).toBe('write')
    expect(groupRight(null, { own: 1, readable: [] })).toBe('write')
  })

  it('lets the viewer write in the own group', () => {
    expect(groupRight(1, access)).toBe('write')
  })

  it('lets the viewer only read a granted group', () => {
    expect(groupRight(2, access)).toBe('read')
    expect(groupRight(3, access)).toBe('read')
  })

  it('hides every other group', () => {
    expect(groupRight(4, access)).toBe('none')
    expect(groupRight(2, { own: 1, readable: [] })).toBe('none')
  })
})
