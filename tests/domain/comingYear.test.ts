import { describe, expect, it } from 'vitest'
import { showsComingYear } from '../../app/utils/comingYear'

describe('showsComingYear', () => {
  it('is off on 30 September and on from 1 October to 31 December', () => {
    expect(showsComingYear('2026-09-30', 2026)).toBe(false)
    expect(showsComingYear('2026-10-01', 2026)).toBe(true)
    expect(showsComingYear('2026-11-18', 2026)).toBe(true)
    expect(showsComingYear('2026-12-31', 2026)).toBe(true)
  })
  it('is off again on 1 January', () => {
    expect(showsComingYear('2027-01-01', 2027)).toBe(false)
  })
  it('is off when another year than the current one is viewed', () => {
    expect(showsComingYear('2026-11-18', 2025)).toBe(false)
    expect(showsComingYear('2026-11-18', 2027)).toBe(false)
  })
})
