import { describe, expect, it } from 'vitest'
import { canCreateNote, noteSearchFromQuery, noteVisibilityBadge, noteVisibilityItems } from '../../app/utils/notes'

describe('canCreateNote', () => {
  it('needs the whole facility or an own group', () => {
    expect(canCreateNote(null)).toBe(false)
    expect(canCreateNote({ facility: true, groupId: null, visibilities: ['all', 'managers'] })).toBe(true)
    expect(canCreateNote({ facility: false, groupId: 3, visibilities: ['all'] })).toBe(true)
    expect(canCreateNote({ facility: false, groupId: null, visibilities: ['all'] })).toBe(false)
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

describe('noteVisibilityItems', () => {
  it('labels exactly the levels the writer may choose, in their order', () => {
    expect(noteVisibilityItems(['all', 'managers', 'provider'])).toEqual([
      { label: 'Alle', value: 'all' },
      { label: 'Leitung und Träger', value: 'managers' },
      { label: 'Nur Träger', value: 'provider' },
    ])
    expect(noteVisibilityItems(['all', 'managers'])).toEqual([
      { label: 'Alle', value: 'all' }, { label: 'Leitung und Träger', value: 'managers' },
    ])
    expect(noteVisibilityItems(['all'])).toEqual([{ label: 'Alle', value: 'all' }])
  })
})

describe('noteVisibilityBadge', () => {
  it('names the restricted levels; nothing for a note visible to all', () => {
    expect(noteVisibilityBadge('all')).toBeNull()
    expect(noteVisibilityBadge('managers')).toBe('Leitung und Träger')
    expect(noteVisibilityBadge('provider')).toBe('Nur Träger')
  })
})
