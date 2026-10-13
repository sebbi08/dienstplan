import { describe, expect, it } from 'vitest'
import { kitaYearLabel, kitaYearMonths, kitaYearOf } from '../../shared/domain/kitaYear'

describe('kitaYear', () => {
  it('starts the Kita year on 1 September', () => {
    expect(kitaYearOf('2026-08-31')).toBe(2025)
    expect(kitaYearOf('2026-09-01')).toBe(2026)
    expect(kitaYearOf('2026-12-31')).toBe(2026)
    expect(kitaYearOf('2027-01-01')).toBe(2026)
  })

  it('labels the year with the short second year', () => {
    expect(kitaYearLabel(2026)).toBe('2026/27')
    expect(kitaYearLabel(2099)).toBe('2099/00')
    expect(kitaYearLabel(2009)).toBe('2009/10')
  })

  it('lists twelve months from September to August', () => {
    const months = kitaYearMonths(2026)
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ year: 2026, month: 9 })
    expect(months[3]).toEqual({ year: 2026, month: 12 })
    expect(months[4]).toEqual({ year: 2027, month: 1 })
    expect(months[11]).toEqual({ year: 2027, month: 8 })
  })
})
