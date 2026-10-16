import { describe, expect, it } from 'vitest'
import { ALL_WEEKDAYS, WEEKDAY_BITS, hoursOn, isEntered, ruleAppliesOn, type DayHours, type OpeningHours } from '../../shared/domain/openingHours'

const empty: DayHours = { open: null, close: null, closed: false }
const day = (open: number, close: number): DayHours => ({ open, close, closed: false })

function hours(days: DayHours[]): OpeningHours {
  return { days, minAtOpening: 1, minAtClosing: 1 }
}

// 2026-10-05 is a Monday.
const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']

describe('ruleAppliesOn', () => {
  it('has one bit per weekday and 31 for all', () => {
    expect(WEEKDAY_BITS).toEqual([1, 2, 4, 8, 16])
    expect(ALL_WEEKDAYS).toBe(31)
  })
  it.each(dates.map((date, index) => [date, index] as const))('checks only the set bit on %s', (date, index) => {
    for (let bit = 0; bit < 5; bit++) {
      expect(ruleAppliesOn(WEEKDAY_BITS[bit]!, date)).toBe(bit === index)
    }
    expect(ruleAppliesOn(ALL_WEEKDAYS, date)).toBe(true)
    expect(ruleAppliesOn(0, date)).toBe(false)
  })
  it('never applies on a weekend', () => {
    expect(ruleAppliesOn(ALL_WEEKDAYS, '2026-10-10')).toBe(false)
    expect(ruleAppliesOn(ALL_WEEKDAYS, '2026-10-11')).toBe(false)
  })
})

describe('hoursOn', () => {
  const week = hours([day(420, 990), day(430, 980), empty, { open: null, close: null, closed: true }, day(420, 900)])
  it('returns the entry of the weekday', () => {
    expect(hoursOn(week, '2026-10-05')).toEqual(day(420, 990))
    expect(hoursOn(week, '2026-10-09')).toEqual(day(420, 900))
  })
  it('returns null without hours or on a weekend', () => {
    expect(hoursOn(null, '2026-10-05')).toBeNull()
    expect(hoursOn(week, '2026-10-10')).toBeNull()
    expect(hoursOn(week, '2026-10-11')).toBeNull()
  })
})

describe('isEntered', () => {
  it('needs open and close and not closed', () => {
    expect(isEntered(day(420, 990))).toBe(true)
    expect(isEntered(empty)).toBe(false)
    expect(isEntered({ open: 420, close: null, closed: false })).toBe(false)
    expect(isEntered({ open: null, close: 990, closed: false })).toBe(false)
    expect(isEntered({ open: 420, close: 990, closed: true })).toBe(false)
    expect(isEntered(null)).toBe(false)
  })
})
