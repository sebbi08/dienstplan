import { describe, expect, it } from 'vitest'
import {
  addDays, dateRange, daysBetween, daysInMonth, isoWeekNumber, isValidIsoDate, isWeekend,
  monthDates, parseIsoDate, toIsoDate, todayIso, weekday, weekStart,
} from '../../shared/domain/dates'

describe('dates', () => {
  it('builds and parses ISO dates', () => {
    expect(toIsoDate(2026, 10, 5)).toBe('2026-10-05')
    expect(parseIsoDate('2026-10-05')).toEqual({ year: 2026, month: 10, day: 5 })
  })
  it('validates calendar dates', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true)
    expect(isValidIsoDate('2026-10-05')).toBe(true)
    for (const bad of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-01', '']) {
      expect(isValidIsoDate(bad)).toBe(false)
    }
  })
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7)
  })
  it('computes weekdays with Monday = 0', () => {
    expect(weekday('2026-10-05')).toBe(0)
    expect(weekday('2026-10-11')).toBe(6)
    expect(isWeekend('2026-10-10')).toBe(true)
    expect(isWeekend('2026-10-09')).toBe(false)
  })
  it('lists month dates', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(monthDates(2026, 2)).toHaveLength(28)
    expect(monthDates(2026, 10)[0]).toBe('2026-10-01')
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('computes ISO weeks', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05')
    expect(weekStart('2026-10-01')).toBe('2026-09-28')
    expect(isoWeekNumber('2026-10-05')).toBe(41)
    expect(isoWeekNumber('2027-01-01')).toBe(53)
    expect(isoWeekNumber('2027-01-04')).toBe(1)
  })
  it('returns today in Europe/Berlin', () => {
    expect(todayIso(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01')
    expect(todayIso(new Date('2026-09-30T21:30:00Z'))).toBe('2026-09-30')
  })
})
