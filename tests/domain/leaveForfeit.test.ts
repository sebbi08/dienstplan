import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEAVE_FORFEIT_TEXT, fillLeaveForfeitText, forfeitDateOf, isValidForfeitDate, isValidForfeitText, leaveForfeitNoticeYear,
} from '../../shared/domain/leaveForfeit'

const march31 = { day: 31, month: 3 }

describe('the window of the notice on remaining leave', () => {
  it('opens on 1 October and lasts until the forfeiture date of the year after', () => {
    expect(leaveForfeitNoticeYear('2026-09-30', march31)).toBeNull()
    expect(leaveForfeitNoticeYear('2026-10-01', march31)).toBe(2026)
    expect(leaveForfeitNoticeYear('2026-12-31', march31)).toBe(2026)
    expect(leaveForfeitNoticeYear('2027-01-01', march31)).toBe(2026)
    expect(leaveForfeitNoticeYear('2027-03-31', march31)).toBe(2026)
    expect(leaveForfeitNoticeYear('2027-04-01', march31)).toBeNull()
  })

  it('follows a forfeiture date of the facility', () => {
    const may31 = { day: 31, month: 5 }
    expect(leaveForfeitNoticeYear('2027-05-31', may31)).toBe(2026)
    expect(leaveForfeitNoticeYear('2027-06-01', may31)).toBeNull()
    expect(forfeitDateOf(2026, may31)).toBe('2027-05-31')
    expect(leaveForfeitNoticeYear('2027-02-15', { day: 15, month: 2 })).toBe(2026)
    expect(leaveForfeitNoticeYear('2027-02-16', { day: 15, month: 2 })).toBeNull()
  })

  it('takes a day of January to September only, never 29 February', () => {
    expect(isValidForfeitDate(march31)).toBe(true)
    expect(isValidForfeitDate({ day: 30, month: 9 })).toBe(true)
    expect(isValidForfeitDate({ day: 28, month: 2 })).toBe(true)
    expect(isValidForfeitDate({ day: 29, month: 2 })).toBe(false)
    expect(isValidForfeitDate({ day: 31, month: 4 })).toBe(false)
    expect(isValidForfeitDate({ day: 1, month: 10 })).toBe(false)
    expect(isValidForfeitDate({ day: 0, month: 3 })).toBe(false)
    expect(isValidForfeitDate({ day: 1.5, month: 3 })).toBe(false)
  })
})

describe('an own notice text', () => {
  it('has to name the days and the forfeiture date; empty is the default text', () => {
    expect(isValidForfeitText('')).toBe(true)
    expect(isValidForfeitText('  ')).toBe(true)
    expect(isValidForfeitText('Noch ‹Tage› Tage, bis ‹Verfall› nehmen.')).toBe(true)
    expect(isValidForfeitText(DEFAULT_LEAVE_FORFEIT_TEXT)).toBe(true)
    expect(isValidForfeitText('Bitte Urlaub planen.')).toBe(false)
    expect(isValidForfeitText('Noch ‹Tage› Tage aus ‹Jahr›.')).toBe(false)
    expect(isValidForfeitText('Bis ‹Verfall› planen.')).toBe(false)
  })
})

describe('the notice text', () => {
  const values = { days: 5, year: 2026, forfeitDate: '2027-03-31' }

  it('fills the placeholders of the default text', () => {
    expect(fillLeaveForfeitText(DEFAULT_LEAVE_FORFEIT_TEXT, values)).toBe(
      'Du hast noch 5 Tage Urlaub aus 2026. Bitte plane sie rechtzeitig ein. Urlaub, der bis zum 31.03.2027 nicht genommen ist, verfällt.',
    )
  })

  it('writes half days the German way and a single day as „1 Tag“', () => {
    expect(fillLeaveForfeitText(DEFAULT_LEAVE_FORFEIT_TEXT, { ...values, days: 2.5 })).toContain('noch 2,5 Tage Urlaub')
    expect(fillLeaveForfeitText(DEFAULT_LEAVE_FORFEIT_TEXT, { ...values, days: 1 })).toContain('noch 1 Tag Urlaub')
  })

  it('fills a text of the facility, each placeholder as often as it comes', () => {
    expect(fillLeaveForfeitText('Resturlaub ‹Jahr›: ‹Tage›. Frist ‹Verfall› (‹Jahr›).', { ...values, forfeitDate: '2027-05-31' }))
      .toBe('Resturlaub 2026: 5. Frist 31.05.2027 (2026).')
  })
})
