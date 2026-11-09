import { describe, expect, it } from 'vitest'
import { canCreateNote, noteSearchFromQuery } from '../../app/utils/notes'

describe('canCreateNote', () => {
  it('needs the whole facility or an own group', () => {
    expect(canCreateNote(null)).toBe(false)
    expect(canCreateNote({ facility: true, groupId: null })).toBe(true)
    expect(canCreateNote({ facility: false, groupId: 3 })).toBe(true)
    expect(canCreateNote({ facility: false, groupId: null })).toBe(false)
  })
})

describe('noteSearchFromQuery', () => {
  it('takes the search from the address as typed, at most 100 chars; anything else is no search', () => {
    expect(noteSearchFromQuery('Bären Wald')).toBe('Bären Wald')
    expect(noteSearchFromQuery(' Bären ')).toBe(' Bären ')
    expect(noteSearchFromQuery('x'.repeat(120))).toBe('x'.repeat(100))
    expect(noteSearchFromQuery(undefined)).toBe('')
    expect(noteSearchFromQuery(['a', 'b'])).toBe('')
    expect(noteSearchFromQuery(null)).toBe('')
  })
})
