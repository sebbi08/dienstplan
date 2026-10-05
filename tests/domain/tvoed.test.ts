import { describe, expect, it } from 'vitest'
import { levelBySeniority, seniority, SUGGESTED_PAY_GROUP } from '../../shared/domain/tvoed'

describe('TVöD SuE helpers', () => {
  it('suggests the level from the years of service and the date of the next level', () => {
    const since = '2019-03-01'
    expect(levelBySeniority(since, '2019-03-01')).toEqual({ level: 1, nextLevel: 2, nextOn: '2020-03-01' })
    expect(levelBySeniority(since, '2020-03-01')).toEqual({ level: 2, nextLevel: 3, nextOn: '2023-03-01' })
    expect(levelBySeniority(since, '2026-10-05')).toEqual({ level: 3, nextLevel: 4, nextOn: '2027-03-01' })
    expect(levelBySeniority(since, '2031-03-01')).toEqual({ level: 5, nextLevel: 6, nextOn: '2036-03-01' })
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
