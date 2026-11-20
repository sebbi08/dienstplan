import { describe, expect, it } from 'vitest'
import { computedSchoolStart, DEFAULT_SCHOOL_CUTOFF, effectiveSchoolStart } from '../../shared/domain/schoolStart'
import { schoolCutoffOf, type GermanState } from '../../shared/domain/states'

describe('schoolStart', () => {
  it('uses the cutoff day inclusively', () => {
    expect(computedSchoolStart('2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-07-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
    expect(computedSchoolStart('2021-01-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-12-31', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
  })

  // The stored cut-off is the last birthday that belongs to the year (user decision 20.11.2026: „letzter Stichtag ist
  // 30. Juni“ in Baden-Württemberg; born 1 July starts a year later).
  it('follows the state presets: born on the cut-off day this year, the day after next year', () => {
    const start = (state: GermanState, birth: string) => computedSchoolStart(birth, schoolCutoffOf(state))
    expect(start('BW', '2021-06-30')).toBe('2027-09-01')
    expect(start('BW', '2021-07-01')).toBe('2028-09-01')
    // HH: § 38 Abs. 1 HmbSG „vor dem 1. Juli das 6. Lebensjahr vollendet“ = born up to 1 July
    expect(start('HH', '2021-07-01')).toBe('2027-09-01')
    expect(start('HH', '2021-07-02')).toBe('2028-09-01')
    // BY (Art. 37 BayEUG) and NW (§ 35 SchulG): born up to 30 September
    expect(start('BY', '2021-09-30')).toBe('2027-09-01')
    expect(start('BY', '2021-10-01')).toBe('2028-09-01')
    expect(start('NW', '2021-09-30')).toBe('2027-09-01')
    expect(start('NW', '2021-10-01')).toBe('2028-09-01')
    expect(start('BB', '2021-09-30')).toBe('2027-09-01')
    expect(start('BB', '2021-10-01')).toBe('2028-09-01')
    // TH: § 18 Abs. 1 ThürSchulG „am 1. August eines Jahres sechs Jahre alt“ = born up to 1 August
    expect(start('TH', '2021-08-01')).toBe('2027-09-01')
    expect(start('TH', '2021-08-02')).toBe('2028-09-01')
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

  it('handles a cutoff on the last day of the year', () => {
    expect(computedSchoolStart('2021-12-31', { month: 12, day: 31, ageYears: 6 })).toBe('2027-09-01')
    expect(computedSchoolStart('2022-01-01', { month: 12, day: 31, ageYears: 6 })).toBe('2028-09-01')
  })

  it('honours other ages', () => {
    expect(computedSchoolStart('2021-06-30', { month: 6, day: 30, ageYears: 4 })).toBe('2025-09-01')
    expect(computedSchoolStart('2021-07-01', { month: 6, day: 30, ageYears: 4 })).toBe('2026-09-01')
    expect(computedSchoolStart('2021-06-30', { month: 6, day: 30, ageYears: 8 })).toBe('2029-09-01')
    expect(computedSchoolStart('2021-07-01', { month: 6, day: 30, ageYears: 8 })).toBe('2030-09-01')
  })

  it('keeps 29 February when the birthday really exists in the target year', () => {
    // born 29 Feb 2020, age 4 -> 29 Feb 2024 (leap year)
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 29, ageYears: 4 })).toBe('2024-09-01')
    // reached on 29 Feb, one day after a 28 Feb cutoff
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 28, ageYears: 4 })).toBe('2025-09-01')
    // born 29 Feb 2016, age 8 -> 29 Feb 2024
    expect(computedSchoolStart('2016-02-29', { month: 2, day: 28, ageYears: 8 })).toBe('2025-09-01')
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
