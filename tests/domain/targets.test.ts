import { describe, expect, it } from 'vitest'
import { BW_RULES } from '../../shared/domain/holidays'
import {
  dailyTarget, employmentStart, isEmployedInRange, isEmployedOn, isWorkday, MONDAY_TO_FRIDAY, weeklyMinutesOn,
  type EmploymentInfo,
} from '../../shared/domain/targets'

const fullTime: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }

describe('targets', () => {
  it('derives the daily target from weekly hours (39 h → 7:48 h)', () => {
    expect(dailyTarget(fullTime, '2026-10-05')).toBe(468)
  })
  it('has no target on weekends, holidays and before employment', () => {
    expect(dailyTarget(fullTime, '2026-10-10')).toBe(0)
    expect(dailyTarget(fullTime, '2026-12-25')).toBe(0)
    expect(dailyTarget(fullTime, '2025-12-31')).toBe(0)
  })
  it('applies a change of weekly hours from its valid-from day, even mid-week', () => {
    const info: EmploymentInfo = {
      hours: [{ weeklyMinutes: 1800, validFrom: '2026-10-07' }, { weeklyMinutes: 2340, validFrom: '2026-01-01' }],
      leftOn: null,
      holidays: BW_RULES,
    }
    expect(weeklyMinutesOn(info, '2026-10-06')).toBe(2340)
    expect(dailyTarget(info, '2026-10-06')).toBe(468)
    expect(dailyTarget(info, '2026-10-07')).toBe(360)
    expect(employmentStart(info)).toBe('2026-01-01')
  })
  it('ends employment after the leaving day', () => {
    const info: EmploymentInfo = { ...fullTime, leftOn: '2026-10-15' }
    expect(isEmployedOn(info, '2026-10-15')).toBe(true)
    expect(isEmployedOn(info, '2026-10-16')).toBe(false)
    expect(dailyTarget(info, '2026-10-16')).toBe(0)
    expect(isEmployedInRange(info, '2026-10-01', '2026-10-31')).toBe(true)
    expect(isEmployedInRange(info, '2026-11-01', '2026-11-30')).toBe(false)
  })
  it('treats employees without hours as not employed', () => {
    const info: EmploymentInfo = { hours: [], leftOn: null, holidays: BW_RULES }
    expect(isEmployedOn(info, '2026-10-05')).toBe(false)
    expect(employmentStart(info)).toBeNull()
  })
})

describe('working days', () => {
  // 20 h on Monday–Wednesday from 2026-10-01
  const partTime = { hours: [{ weeklyMinutes: 1200, validFrom: '2026-10-01', workdays: 0b00111 }], leftOn: null, holidays: BW_RULES }

  it('spreads the weekly hours over the working days only', () => {
    expect(dailyTarget(partTime, '2026-10-05')).toBe(400) // Monday: 1200 / 3
    expect(dailyTarget(partTime, '2026-10-07')).toBe(400) // Wednesday
    expect(dailyTarget(partTime, '2026-10-08')).toBe(0) // Thursday: free
    expect(dailyTarget(partTime, '2026-10-10')).toBe(0) // Saturday
  })
  it('knows the working days of an employee', () => {
    expect(isWorkday(partTime, '2026-10-06')).toBe(true)
    expect(isWorkday(partTime, '2026-10-09')).toBe(false) // Friday
    expect(isWorkday(partTime, '2026-12-25')).toBe(false) // holiday
    expect(isWorkday(partTime, '2026-09-28')).toBe(false) // before employment
  })
  it('treats periods without working days as Monday to Friday', () => {
    const info = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }
    expect(isWorkday(info, '2026-10-09')).toBe(true)
    expect(dailyTarget(info, '2026-10-09')).toBe(468)
  })
  it('uses the working days of the period valid on that day', () => {
    const info = {
      hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01', workdays: MONDAY_TO_FRIDAY }, { weeklyMinutes: 1200, validFrom: '2026-10-01', workdays: 0b00111 }],
      leftOn: null,
      holidays: BW_RULES,
    }
    expect(dailyTarget(info, '2026-09-25')).toBe(468) // Friday, still full time
    expect(dailyTarget(info, '2026-10-09')).toBe(0) // Friday, part time from October
  })
})
