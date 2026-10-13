import { describe, expect, it } from 'vitest'
import { computedSchoolStart, DEFAULT_SCHOOL_CUTOFF, effectiveSchoolStart } from '../../shared/domain/schoolStart'

describe('schoolStart', () => {
  it('uses the cutoff day inclusively', () => {
    expect(computedSchoolStart('2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-07-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
    expect(computedSchoolStart('2021-01-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-12-31', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
  })

  it('counts a 29 February birthday as reached on 28 February in non-leap years', () => {
    expect(computedSchoolStart('2020-02-29', DEFAULT_SCHOOL_CUTOFF)).toBe('2026-09-01')
    // cutoff 28 February: reached on exactly the cutoff day
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 28, ageYears: 6 })).toBe('2026-09-01')
    // cutoff 27 February: one day too late
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 27, ageYears: 6 })).toBe('2027-09-01')
  })

  it('works with another cutoff month and age', () => {
    expect(computedSchoolStart('2021-09-30', { month: 9, day: 30, ageYears: 6 })).toBe('2027-09-01')
    expect(computedSchoolStart('2021-10-01', { month: 9, day: 30, ageYears: 6 })).toBe('2028-09-01')
    expect(computedSchoolStart('2021-06-30', { month: 6, day: 30, ageYears: 5 })).toBe('2026-09-01')
  })

  it('treats a 29 February cutoff as the last day of February in non-leap years', () => {
    const cutoff = { month: 2, day: 29, ageYears: 6 }
    // born 28 February 2020: reached 28 February 2026 = last February day of 2026
    expect(computedSchoolStart('2020-02-28', cutoff)).toBe('2026-09-01')
    // born 1 March 2020: reached after the cutoff in 2026
    expect(computedSchoolStart('2020-03-01', cutoff)).toBe('2027-09-01')
    // born 29 February 2020: reached 28 February 2026, cutoff clamps to 28 February
    expect(computedSchoolStart('2020-02-29', cutoff)).toBe('2026-09-01')
    // leap year: born 28 February 2018, reached 28 February 2024 <= 29 February 2024
    expect(computedSchoolStart('2018-02-28', cutoff)).toBe('2024-09-01')
    // leap year: born 1 March 2018, reached after 29 February 2024
    expect(computedSchoolStart('2018-03-01', cutoff)).toBe('2025-09-01')
  })

  it('prefers a manual school start', () => {
    expect(effectiveSchoolStart('2028-09-01', '2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
    expect(effectiveSchoolStart(null, '2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
  })
})
