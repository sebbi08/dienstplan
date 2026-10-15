import { describe, expect, it } from 'vitest'
import {
  BW_RULES, easterSunday, holidayIn, holidaysOf, isHolidayIn,
  type HolidayKey, type HolidayRules,
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
    const holidays = holidaysOf(BW_RULES, 2026)
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
    expect(holidayIn('2026-10-31', BW_RULES)).toBeNull()
    expect(holidayIn('2026-11-18', BW_RULES)).toBeNull()
  })
  it('answers lookups for any year', () => {
    expect(isHolidayIn('2027-01-01', BW_RULES)).toBe(true)
    expect(holidayIn('2027-05-06', BW_RULES)).toBe('ascension_day')
    expect(isHolidayIn('2026-10-05', BW_RULES)).toBe(false)
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

  it('the number of holidays per state in 2024–2027', () => {
    // Every listed holiday counts, also when it falls on a weekend; none of them coincide in these years.
    const counts: Record<GermanState, number> = {
      BW: 12, BY: 13, BE: 10, BB: 10, HB: 10, HH: 10, HE: 10, MV: 11,
      NI: 10, NW: 11, RP: 11, SL: 12, SN: 11, ST: 11, SH: 10, TH: 11,
    }
    for (const year of [2024, 2025, 2026, 2027]) {
      for (const state of GERMAN_STATES) {
        expect(holidaysOf(rulesOf(state), year).size, `${state} ${year}`).toBe(counts[state])
      }
      expect(holidaysOf(rulesOf('BY', false), year).size, `BY without Assumption Day ${year}`).toBe(12)
    }
  })

  it('every state\'s holidays in 2024–2027 against a fixed calendar', () => {
    const moveable: Record<number, Partial<Record<HolidayKey, string>>> = {
      2024: { good_friday: '03-29', easter_monday: '04-01', ascension_day: '05-09', whit_monday: '05-20', corpus_christi: '05-30', repentance_day: '11-20' },
      2025: { good_friday: '04-18', easter_monday: '04-21', ascension_day: '05-29', whit_monday: '06-09', corpus_christi: '06-19', repentance_day: '11-19' },
      2026: { good_friday: '04-03', easter_monday: '04-06', ascension_day: '05-14', whit_monday: '05-25', corpus_christi: '06-04', repentance_day: '11-18' },
      2027: { good_friday: '03-26', easter_monday: '03-29', ascension_day: '05-06', whit_monday: '05-17', corpus_christi: '05-27', repentance_day: '11-17' },
    }
    const fixed: Partial<Record<HolidayKey, string>> = {
      new_year: '01-01', epiphany: '01-06', womens_day: '03-08', labour_day: '05-01', assumption_day: '08-15',
      childrens_day: '09-20', german_unity_day: '10-03', reformation_day: '10-31', all_saints_day: '11-01',
      christmas_day: '12-25', boxing_day: '12-26',
    }
    const nationwide: HolidayKey[] = [
      'new_year', 'good_friday', 'easter_monday', 'labour_day', 'ascension_day', 'whit_monday', 'german_unity_day',
      'christmas_day', 'boxing_day',
    ]
    const regional: Partial<Record<HolidayKey, GermanState[]>> = {
      epiphany: ['BW', 'BY', 'ST'],
      womens_day: ['BE', 'MV'],
      corpus_christi: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'],
      assumption_day: ['SL', 'BY'],
      childrens_day: ['TH'],
      reformation_day: ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'],
      all_saints_day: ['BW', 'BY', 'NW', 'RP', 'SL'],
      repentance_day: ['SN'],
    }
    for (const year of [2024, 2025, 2026, 2027]) {
      const dateOf = (key: HolidayKey) => `${year}-${moveable[year]![key] ?? fixed[key]}`
      for (const state of GERMAN_STATES) {
        const keys = [...nationwide, ...(Object.keys(regional) as HolidayKey[]).filter(key => regional[key]!.includes(state))]
        const expected = Object.fromEntries(keys.map(key => [dateOf(key), key]))
        expect(Object.fromEntries(holidaysOf(rulesOf(state), year)), `${state} ${year}`).toEqual(expected)
      }
      const bavariaWithout = Object.fromEntries(holidaysOf(rulesOf('BY', false), year))
      expect(bavariaWithout[dateOf('assumption_day')], `BY ${year}`).toBeUndefined()
      expect(bavariaWithout[dateOf('corpus_christi')], `BY ${year}`).toBe('corpus_christi')
    }
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
})
