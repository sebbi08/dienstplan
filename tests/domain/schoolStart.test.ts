import { describe, expect, it } from 'vitest'
import { computedSchoolStart, DEFAULT_SCHOOL_CUTOFF, effectiveSchoolStart } from '../../shared/domain/schoolStart'
import { schoolCutoffOf, type GermanState } from '../../shared/domain/states'

describe('schoolStart', () => {
  // „bis zum Stichtag das 6. Lebensjahr vollendet“: a year of life is completed at the end of the day before the
  // birthday (§ 187 Abs. 2, § 188 Abs. 2 BGB), so a child born on the day after the cutoff still belongs to it.
  it('counts a child born on the day after the cutoff (the year is completed the day before the birthday)', () => {
    expect(computedSchoolStart('2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-07-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-07-02', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
    expect(computedSchoolStart('2021-01-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
    expect(computedSchoolStart('2021-12-31', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
  })

  it('follows the school law of the states: born 30.06., 01.07., 02.07. (and around 30.09.)', () => {
    const start = (state: GermanState, birth: string) => computedSchoolStart(birth, schoolCutoffOf(state))
    // BW: § 73 Abs. 1 SchG „bis 30. Juni … das sechste Lebensjahr vollendet“
    expect(start('BW', '2021-06-30')).toBe('2027-09-01')
    expect(start('BW', '2021-07-01')).toBe('2027-09-01')
    expect(start('BW', '2021-07-02')).toBe('2028-09-01')
    // HE: the authorities say „bis einschließlich 1. Juli geboren“
    expect(start('HE', '2021-07-01')).toBe('2027-09-01')
    expect(start('HE', '2021-07-02')).toBe('2028-09-01')
    // HH: § 38 HmbSG „vor dem 1. Juli … vollendet“ = born up to 1 July (not shifted twice)
    expect(start('HH', '2021-06-30')).toBe('2027-09-01')
    expect(start('HH', '2021-07-01')).toBe('2027-09-01')
    expect(start('HH', '2021-07-02')).toBe('2028-09-01')
    // BB: § 37 BbgSchulG 30. September „vollendet“
    expect(start('BB', '2021-09-30')).toBe('2027-09-01')
    expect(start('BB', '2021-10-01')).toBe('2027-09-01')
    expect(start('BB', '2021-10-02')).toBe('2028-09-01')
    // BY: Art. 37 BayEUG „bis zum 30. September sechs Jahre alt werden“ – the birthday itself decides
    expect(start('BY', '2021-09-30')).toBe('2027-09-01')
    expect(start('BY', '2021-10-01')).toBe('2028-09-01')
    // NW: § 35 SchulG „bis zum Beginn des 30. September … vollendet“ – the same
    expect(start('NW', '2021-09-30')).toBe('2027-09-01')
    expect(start('NW', '2021-10-01')).toBe('2028-09-01')
    // TH: 1 August „vollendet“ → born up to 2 August
    expect(start('TH', '2021-08-02')).toBe('2027-09-01')
    expect(start('TH', '2021-08-03')).toBe('2028-09-01')
  })

  it('completes a year of a 29 February child at the end of 28 February in common years', () => {
    expect(computedSchoolStart('2020-02-29', DEFAULT_SCHOOL_CUTOFF)).toBe('2026-09-01')
    // cutoff 28 February: completed on exactly the cutoff day
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 28, ageYears: 6 })).toBe('2026-09-01')
    // cutoff 27 February: one day too late
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 27, ageYears: 6 })).toBe('2027-09-01')
    // born 1 March: completed at the end of 28 February
    expect(computedSchoolStart('2020-03-01', { month: 2, day: 28, ageYears: 6 })).toBe('2026-09-01')
  })

  it('works with another cutoff month and age', () => {
    expect(computedSchoolStart('2021-09-30', { month: 9, day: 30, ageYears: 6 })).toBe('2027-09-01')
    expect(computedSchoolStart('2021-10-01', { month: 9, day: 30, ageYears: 6 })).toBe('2027-09-01')
    expect(computedSchoolStart('2021-10-02', { month: 9, day: 30, ageYears: 6 })).toBe('2028-09-01')
    expect(computedSchoolStart('2021-06-30', { month: 6, day: 30, ageYears: 5 })).toBe('2026-09-01')
  })

  it('handles a cutoff on the last day of the year', () => {
    expect(computedSchoolStart('2021-12-31', { month: 12, day: 31, ageYears: 6 })).toBe('2027-09-01')
    // born 1 January 2022: six years completed at the end of 31 December 2027
    expect(computedSchoolStart('2022-01-01', { month: 12, day: 31, ageYears: 6 })).toBe('2027-09-01')
    expect(computedSchoolStart('2022-01-02', { month: 12, day: 31, ageYears: 6 })).toBe('2028-09-01')
  })

  it('honours other ages', () => {
    expect(computedSchoolStart('2021-06-30', { month: 6, day: 30, ageYears: 4 })).toBe('2025-09-01')
    expect(computedSchoolStart('2021-07-02', { month: 6, day: 30, ageYears: 4 })).toBe('2026-09-01')
    expect(computedSchoolStart('2021-06-30', { month: 6, day: 30, ageYears: 8 })).toBe('2029-09-01')
    expect(computedSchoolStart('2021-07-02', { month: 6, day: 30, ageYears: 8 })).toBe('2030-09-01')
  })

  it('completes the year of a 29 February child on 28 February also in leap years', () => {
    // born 29 Feb 2020, age 4 -> completed at the end of 28 Feb 2024
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 28, ageYears: 4 })).toBe('2024-09-01')
    expect(computedSchoolStart('2020-02-29', { month: 2, day: 27, ageYears: 4 })).toBe('2025-09-01')
    // born 29 Feb 2016, age 8 -> 28 Feb 2024
    expect(computedSchoolStart('2016-02-29', { month: 2, day: 28, ageYears: 8 })).toBe('2024-09-01')
  })

  it('treats a 29 February cutoff as the last day of February in non-leap years', () => {
    const cutoff = { month: 2, day: 29, ageYears: 6 }
    // born 28 February 2020: completed 27 February 2026
    expect(computedSchoolStart('2020-02-28', cutoff)).toBe('2026-09-01')
    // born 1 March 2020: completed at the end of 28 February 2026 = the clamped cutoff
    expect(computedSchoolStart('2020-03-01', cutoff)).toBe('2026-09-01')
    expect(computedSchoolStart('2020-03-02', cutoff)).toBe('2027-09-01')
    // born 29 February 2020: completed 28 February 2026
    expect(computedSchoolStart('2020-02-29', cutoff)).toBe('2026-09-01')
    // leap year: born 1 March 2018, completed 29 February 2024 = cutoff
    expect(computedSchoolStart('2018-03-01', cutoff)).toBe('2024-09-01')
    expect(computedSchoolStart('2018-03-02', cutoff)).toBe('2025-09-01')
  })

  it('prefers a manual school start', () => {
    expect(effectiveSchoolStart('2028-09-01', '2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
    expect(effectiveSchoolStart(null, '2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
  })
})
