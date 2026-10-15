import { describe, expect, it } from 'vitest'
import { GERMAN_STATES, isGermanState, schoolCutoffOf, type GermanState } from '../../shared/domain/states'

describe('states', () => {
  it('lists the 16 German states', () => {
    expect(GERMAN_STATES).toHaveLength(16)
    expect(new Set(GERMAN_STATES).size).toBe(16)
  })
  it('recognises state codes', () => {
    expect(isGermanState('BW')).toBe(true)
    expect(isGermanState('XX')).toBe(false)
    expect(isGermanState('bw')).toBe(false)
  })
  it('knows the school cutoff of every state', () => {
    const expected: Record<GermanState, [number, number]> = {
      BW: [6, 30], BY: [9, 30], BE: [9, 30], BB: [9, 30], HB: [6, 30], HH: [7, 1], HE: [6, 30], MV: [6, 30],
      NI: [9, 30], NW: [9, 30], RP: [8, 31], SL: [6, 30], SN: [6, 30], ST: [6, 30], SH: [6, 30], TH: [8, 1],
    }
    for (const state of GERMAN_STATES) {
      const [month, day] = expected[state]
      expect(schoolCutoffOf(state), state).toEqual({ month, day, ageYears: 6 })
    }
  })
})
