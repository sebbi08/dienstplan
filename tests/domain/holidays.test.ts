import { describe, expect, it } from 'vitest'
import {
  BW_RULES, bwHolidays, easterSunday, holidayIn, holidayOn, holidaysOf, isHoliday, isHolidayIn,
  type HolidayRules,
} from '../../shared/domain/holidays'
import { GERMAN_STATES, type GermanState } from '../../shared/domain/states'

const rulesOf = (state: GermanState, assumptionDay = true): HolidayRules => ({ state, assumptionDay })

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

  it('the nationwide holidays of 2026', () => {
    const nationwide = [
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14',
      '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
    ] as const
    for (const state of GERMAN_STATES) {
      const holidays = holidaysOf(rulesOf(state), 2026)
      for (const date of nationwide) expect(holidays.has(date), `${state} ${date}`).toBe(true)
    }
  })

  it('moveable feasts 2024–2027', () => {
    const expected: Record<number, string[]> = {
      2024: ['03-29', '04-01', '05-09', '05-20', '05-30'],
      2025: ['04-18', '04-21', '05-29', '06-09', '06-19'],
      2026: ['04-03', '04-06', '05-14', '05-25', '06-04'],
      2027: ['03-26', '03-29', '05-06', '05-17', '05-27'],
    }
    const keys = ['good_friday', 'easter_monday', 'ascension_day', 'whit_monday', 'corpus_christi']
    for (const [year, dates] of Object.entries(expected)) {
      dates.forEach((date, index) => {
        expect(holidayIn(`${year}-${date}`, BW_RULES)).toBe(keys[index])
      })
    }
  })

  it('the number of holidays per state in 2026', () => {
    const counts: Record<GermanState, number> = {
      BW: 12, BY: 13, BE: 10, BB: 10, HB: 10, HH: 10, HE: 10, MV: 11,
      NI: 10, NW: 11, RP: 11, SL: 12, SN: 11, ST: 11, SH: 10, TH: 11,
    }
    for (const state of GERMAN_STATES) {
      expect(holidaysOf(rulesOf(state), 2026).size, state).toBe(counts[state])
    }
    expect(holidaysOf(rulesOf('BY', false), 2026).size).toBe(12)
  })

  it('state-specific days', () => {
    expect(holidayIn('2026-03-08', rulesOf('BE'))).toBe('womens_day')
    expect(holidayIn('2026-03-08', rulesOf('BW'))).toBeNull()
    expect(holidayIn('2026-09-20', rulesOf('TH'))).toBe('childrens_day')
    expect(holidayIn('2026-10-31', rulesOf('NI'))).toBe('reformation_day')
    expect(holidayIn('2026-10-31', rulesOf('BY'))).toBeNull()
    expect(holidayIn('2026-08-15', rulesOf('SL'))).toBe('assumption_day')
    expect(holidayIn('2026-08-15', rulesOf('BY', true))).toBe('assumption_day')
    expect(holidayIn('2026-08-15', rulesOf('BY', false))).toBeNull()
    expect(holidayIn('2026-08-15', rulesOf('BW'))).toBeNull()
    expect(holidayIn('2026-01-06', rulesOf('ST'))).toBe('epiphany')
    expect(holidayIn('2026-01-06', rulesOf('BE'))).toBeNull()
    expect(holidayIn('2026-11-01', rulesOf('RP'))).toBe('all_saints_day')
    expect(holidayIn('2026-11-01', rulesOf('HE'))).toBeNull()
    expect(holidayIn('2026-06-04', rulesOf('HE'))).toBe('corpus_christi')
    expect(holidayIn('2026-06-04', rulesOf('SN'))).toBeNull()
    expect(isHolidayIn('2026-03-08', rulesOf('BE'))).toBe(true)
    expect(isHolidayIn('2026-03-08', rulesOf('BW'))).toBe(false)
  })

  it('repentance day is the Wednesday before 23 November', () => {
    const dates = ['2024-11-20', '2025-11-19', '2026-11-18', '2027-11-17', '2028-11-22']
    for (const date of dates) {
      expect(holidayIn(date, rulesOf('SN'))).toBe('repentance_day')
      expect(holidayIn(date, rulesOf('BW'))).toBeNull()
    }
  })

  it('the old BW helpers are unchanged', () => {
    expect(bwHolidays(2026)).toEqual(holidaysOf(BW_RULES, 2026))
  })
})
