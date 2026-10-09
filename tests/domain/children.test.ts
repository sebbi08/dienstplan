import { describe, expect, it } from 'vitest'
import { ageOn, childStatus, nextBirthday, purgeDate } from '../../shared/domain/children'

describe('childStatus', () => {
  it('is planned without an entry date or before it', () => {
    expect(childStatus({ entryDate: null, leftOn: null }, '2026-10-08')).toBe('planned')
    expect(childStatus({ entryDate: '2026-11-01', leftOn: null }, '2026-10-08')).toBe('planned')
  })

  it('is active from the entry day through the leaving day', () => {
    expect(childStatus({ entryDate: '2026-10-08', leftOn: null }, '2026-10-08')).toBe('active')
    expect(childStatus({ entryDate: '2024-09-01', leftOn: '2026-10-08' }, '2026-10-08')).toBe('active')
  })

  it('is archived the day after leaving', () => {
    expect(childStatus({ entryDate: '2024-09-01', leftOn: '2026-10-07' }, '2026-10-08')).toBe('archived')
  })
})

describe('purgeDate', () => {
  it('adds whole years', () => {
    expect(purgeDate('2026-07-31', 3)).toBe('2029-07-31')
  })

  it('moves 29 February to 28 February in a non-leap target year', () => {
    expect(purgeDate('2024-02-29', 1)).toBe('2025-02-28')
    expect(purgeDate('2024-02-29', 4)).toBe('2028-02-29')
  })
})

describe('ageOn', () => {
  it('counts full years and months', () => {
    expect(ageOn('2022-03-15', '2026-10-08')).toEqual({ years: 4, months: 6 })
    expect(ageOn('2022-03-15', '2026-10-15')).toEqual({ years: 4, months: 7 })
    expect(ageOn('2022-10-08', '2026-10-08')).toEqual({ years: 4, months: 0 })
    expect(ageOn('2022-10-09', '2026-10-08')).toEqual({ years: 3, months: 11 })
  })

  it('counts a birth day the month does not have on the last day of the month', () => {
    expect(ageOn('2020-02-29', '2027-02-28')).toEqual({ years: 7, months: 0 })
    expect(ageOn('2020-02-29', '2027-02-27')).toEqual({ years: 6, months: 11 })
    expect(ageOn('2020-02-29', '2028-02-28')).toEqual({ years: 7, months: 11 })
    expect(ageOn('2020-02-29', '2028-02-29')).toEqual({ years: 8, months: 0 })
    expect(ageOn('2025-01-31', '2025-02-28')).toEqual({ years: 0, months: 1 })
    expect(ageOn('2025-01-31', '2025-02-27')).toEqual({ years: 0, months: 0 })
    expect(ageOn('2025-01-31', '2025-04-30')).toEqual({ years: 0, months: 3 })
  })
})

describe('nextBirthday', () => {
  it('counts today as the next birthday', () => {
    expect(nextBirthday('2022-10-08', '2026-10-08')).toEqual({ date: '2026-10-08', turns: 4 })
  })

  it('rolls over to next year once the birthday has passed', () => {
    expect(nextBirthday('2022-03-15', '2026-10-08')).toEqual({ date: '2027-03-15', turns: 5 })
  })

  it('moves a 29 February birthday to 28 February in non-leap years', () => {
    expect(nextBirthday('2020-02-29', '2027-01-10')).toEqual({ date: '2027-02-28', turns: 7 })
    expect(nextBirthday('2020-02-29', '2027-12-01')).toEqual({ date: '2028-02-29', turns: 8 })
  })
})
