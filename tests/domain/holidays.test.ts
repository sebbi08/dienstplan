import { describe, expect, it } from 'vitest'
import { bwHolidays, easterSunday, holidayOn, isHoliday } from '../../shared/domain/holidays'

describe('holidays', () => {
  it('computes Easter Sunday', () => {
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
  })
  it('lists the 12 Baden-Württemberg holidays for 2026', () => {
    const holidays = bwHolidays(2026)
    expect(holidays.size).toBe(12)
    expect(holidays.get('2026-01-06')).toBe('epiphany')
    expect(holidays.get('2026-04-03')).toBe('good_friday')
    expect(holidays.get('2026-04-06')).toBe('easter_monday')
    expect(holidays.get('2026-05-14')).toBe('ascension_day')
    expect(holidays.get('2026-05-25')).toBe('whit_monday')
    expect(holidays.get('2026-06-04')).toBe('corpus_christi')
    expect(holidays.get('2026-10-03')).toBe('german_unity_day')
    expect(holidays.get('2026-11-01')).toBe('all_saints_day')
  })
  it('does not include holidays of other states', () => {
    expect(holidayOn('2026-10-31')).toBeNull()
    expect(holidayOn('2026-11-18')).toBeNull()
  })
  it('answers lookups for any year', () => {
    expect(isHoliday('2027-01-01')).toBe(true)
    expect(holidayOn('2027-05-06')).toBe('ascension_day')
    expect(isHoliday('2026-10-05')).toBe(false)
  })
})
