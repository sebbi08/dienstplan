import { describe, expect, it } from 'vitest'
import { inState } from '../../app/utils/states'

describe('inState', () => {
  it('puts the right preposition before the state', () => {
    expect(inState('BE')).toBe('in Berlin')
    expect(inState('BW')).toBe('in Baden-Württemberg')
    expect(inState('SL')).toBe('im Saarland')
  })
})
