import { describe, expect, it } from 'vitest'
import { closureDefaultDate, closureYearFromQuery, closuresInYear } from '../../app/utils/closures'

const closure = (id: number, startDate: string, endDate: string) => ({ id, startDate, endDate })

describe('closuresInYear', () => {
  const list = [
    closure(1, '2025-08-04', '2025-08-15'), // the year before
    closure(2, '2025-12-22', '2026-01-02'), // across the turn of the year
    closure(3, '2026-08-03', '2026-08-14'), // within
    closure(4, '2026-12-24', '2027-01-05'), // across the next turn of the year
    closure(5, '2027-05-14', '2027-05-14'), // the year after
  ]
  it('keeps the closures overlapping the year, in the given order', () => {
    expect(closuresInYear(list, 2026).map(entry => entry.id)).toEqual([2, 3, 4])
  })
  it('shows a closure across the turn of the year in both years', () => {
    expect(closuresInYear(list, 2025).map(entry => entry.id)).toEqual([1, 2])
    expect(closuresInYear(list, 2027).map(entry => entry.id)).toEqual([4, 5])
  })
  it('keeps closures on 1 January or 31 December', () => {
    expect(closuresInYear([closure(6, '2026-01-01', '2026-01-01'), closure(7, '2026-12-31', '2026-12-31')], 2026)).toHaveLength(2)
  })
  it('is empty for a year without closures', () => {
    expect(closuresInYear(list, 2030)).toEqual([])
  })
})

describe('closureDefaultDate', () => {
  it('is today in the current year', () => {
    expect(closureDefaultDate('2026-11-18', 2026)).toBe('2026-11-18')
  })
  it('is the first working day of another year (2 January or the Monday after)', () => {
    expect(closureDefaultDate('2026-11-18', 2027)).toBe('2027-01-04') // 2 January 2027 is a Saturday
    expect(closureDefaultDate('2026-11-18', 2025)).toBe('2025-01-02') // a Thursday
    expect(closureDefaultDate('2026-11-18', 2028)).toBe('2028-01-03') // 2 January 2028 is a Sunday
  })
})

describe('closureYearFromQuery', () => {
  it('reads a plausible year and falls back to the current one', () => {
    expect(closureYearFromQuery('2027', 2026)).toBe(2027)
    expect(closureYearFromQuery(undefined, 2026)).toBe(2026)
    expect(closureYearFromQuery('abc', 2026)).toBe(2026)
    expect(closureYearFromQuery('1999', 2026)).toBe(2026)
    expect(closureYearFromQuery(['2027'], 2026)).toBe(2026)
  })
})
