import { describe, expect, it } from 'vitest'
import {
  dailyTarget, employmentStart, isEmployedInRange, isEmployedOn, weeklyMinutesOn,
  type EmploymentInfo,
} from '../../shared/domain/targets'

const fullTime: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }

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
    const info: EmploymentInfo = { hours: [], leftOn: null }
    expect(isEmployedOn(info, '2026-10-05')).toBe(false)
    expect(employmentStart(info)).toBeNull()
  })
})
