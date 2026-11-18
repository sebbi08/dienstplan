import { describe, expect, it } from 'vitest'
import { dueLevelUp, levelBySeniority, levelStart, seniority, SUGGESTED_PAY_GROUP } from '../../shared/domain/tvoed'

describe('level start after training or studies in the facility', () => {
  it('starts with the employment when no training end is set', () => {
    expect(levelStart('2019-03-01', null, false)).toBe('2019-03-01')
    expect(levelStart('2019-03-01', null, true)).toBe('2019-03-01')
  })
  it('starts the day after the training end, so the training gives no level years', () => {
    expect(levelStart('2021-09-01', '2024-07-31', false)).toBe('2024-08-01')
    expect(levelStart('2021-09-01', '2024-12-31', false)).toBe('2025-01-01')
  })
  it('counts the recognition year as level 1: one year before the day after the training end', () => {
    expect(levelStart('2021-09-01', '2024-07-31', true)).toBe('2023-08-01')
    // The first year after the training is then level 2 (without it level 1).
    expect(levelBySeniority(levelStart('2021-09-01', '2024-07-31', true), '2024-08-01').level).toBe(2)
    expect(levelBySeniority(levelStart('2021-09-01', '2024-07-31', false), '2024-08-01').level).toBe(1)
    // Day after 29 February: the year before ends on 28 February, so 29 February is already level 2.
    expect(levelStart('2020-09-01', '2024-02-28', true)).toBe('2023-02-28')
    expect(levelBySeniority(levelStart('2020-09-01', '2024-02-28', true), '2024-02-29').level).toBe(2)
  })
  it('never starts before the employment', () => {
    expect(levelStart('2024-01-01', '2024-07-31', true)).toBe('2024-01-01')
    expect(levelStart('2023-08-01', '2024-07-31', true)).toBe('2023-08-01')
  })
  it('ignores a training end before the employment start', () => {
    expect(levelStart('2024-09-01', '2024-07-31', false)).toBe('2024-09-01')
    expect(levelStart('2024-09-01', '2024-07-31', true)).toBe('2024-09-01')
    expect(levelStart('2024-09-01', '2024-08-31', false)).toBe('2024-09-01')
  })
})

describe('TVöD SuE helpers', () => {
  it('suggests the level from the years of service and the date of the next level', () => {
    const since = '2019-03-01'
    expect(levelBySeniority(since, '2019-03-01')).toEqual({ level: 1, nextLevel: 2, nextOn: '2020-03-01' })
    // Since 01.10.2024: 1 year in level 1, 2 in level 2, 3 in level 3, 4 in level 4, 5 in level 5.
    expect(levelBySeniority(since, '2020-03-01')).toEqual({ level: 2, nextLevel: 3, nextOn: '2022-03-01' })
    expect(levelBySeniority(since, '2022-02-28').level).toBe(2)
    expect(levelBySeniority(since, '2026-10-05')).toEqual({ level: 4, nextLevel: 5, nextOn: '2029-03-01' })
    expect(levelBySeniority(since, '2031-03-01')).toEqual({ level: 5, nextLevel: 6, nextOn: '2034-03-01' })
    expect(levelBySeniority(since, '2034-03-01').level).toBe(6)
    expect(levelBySeniority(since, '2040-01-01')).toEqual({ level: 6, nextLevel: null, nextOn: null })
    expect(levelBySeniority('2024-02-29', '2025-02-28').level).toBe(1)
    expect(levelBySeniority('2024-02-29', '2025-03-01').level).toBe(2)
  })
  it('counts completed years and months of service', () => {
    expect(seniority('2019-03-01', '2026-10-05')).toEqual({ years: 7, months: 7 })
    expect(seniority('2026-09-06', '2026-10-05')).toEqual({ years: 0, months: 0 })
    expect(seniority('2026-11-01', '2026-10-05')).toEqual({ years: 0, months: 0 })
  })
  it('suggests no pay group for the management, whose group depends on the facility size', () => {
    expect([SUGGESTED_PAY_GROUP.educator, SUGGESTED_PAY_GROUP.childcare_worker, SUGGESTED_PAY_GROUP.head]).toEqual(['S 8a', 'S 3', null])
  })
})

describe('level-up notices', () => {
  it('announces the next level from 30 days before until it is entered', () => {
    const since = '2021-03-01' // level 4 is due on 2027-03-01 (after 1 + 2 + 3 years)
    expect(dueLevelUp(since, 3, '2027-01-29')).toBeNull()
    expect(dueLevelUp(since, 3, '2027-01-30')).toEqual({ level: 4, on: '2027-03-01' })
    expect(dueLevelUp(since, 3, '2027-06-01')).toEqual({ level: 4, on: '2027-03-01' }) // overdue, still shown
    expect(dueLevelUp(since, 4, '2027-06-01')).toBeNull() // entered: level 5 only from 2031
    expect(dueLevelUp(since, 6, '2040-01-01')).toBeNull()
    expect(dueLevelUp(since, null, '2027-03-01')).toBeNull()
  })
})
