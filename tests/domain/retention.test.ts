import { describe, expect, it } from 'vitest'
import {
  RETENTION_DEFAULTS, RetentionSettingsError, cashDeletableFrom, checkRetentionSettings, retentionDueDates,
} from '../../shared/domain/retention'

describe('retentionDueDates', () => {
  it('uses the defaults for an employee who left on 2026-03-15', () => {
    expect(retentionDueDates('2026-03-15', RETENTION_DEFAULTS)).toEqual({
      immediate: '2026-03-16',
      time: '2029-01-01',
      assessment: '2030-01-01',
      paidOvertime: '2037-01-01',
    })
  })

  it('does not depend on the day within the year', () => {
    const early = retentionDueDates('2026-01-01', RETENTION_DEFAULTS)
    const late = retentionDueDates('2026-12-31', RETENTION_DEFAULTS)
    expect(early.time).toBe('2029-01-01')
    expect(late.time).toBe('2029-01-01')
    expect(early.paidOvertime).toBe(late.paidOvertime)
  })

  it('moves the immediate date over month and year ends', () => {
    expect(retentionDueDates('2026-12-31', RETENTION_DEFAULTS).immediate).toBe('2027-01-01')
    expect(retentionDueDates('2024-02-28', RETENTION_DEFAULTS).immediate).toBe('2024-02-29')
  })

  it('follows changed periods', () => {
    const due = retentionDueDates('2026-03-15', { ...RETENTION_DEFAULTS, timeYears: 1, assessmentYears: 5, paidOvertimeYears: 40 })
    expect(due.time).toBe('2028-01-01')
    expect(due.assessment).toBe('2032-01-01')
    expect(due.paidOvertime).toBe('2067-01-01')
  })
})

describe('cashDeletableFrom', () => {
  it('is any time without entries', () => {
    expect(cashDeletableFrom(null, 10)).toBeNull()
  })

  it('is 1 January after the retention years of the last entry year', () => {
    expect(cashDeletableFrom('2026-03-10', 10)).toBe('2037-01-01')
    expect(cashDeletableFrom('2026-12-31', 10)).toBe('2037-01-01')
    expect(cashDeletableFrom('2026-01-01', 1)).toBe('2028-01-01')
  })
})

describe('checkRetentionSettings', () => {
  it('has the agreed defaults', () => {
    expect(RETENTION_DEFAULTS).toEqual({
      timeYears: 2, assessmentYears: 3, paidOvertimeYears: 10, pensionYears: 30, cashYears: 10, employeeDelete: 'managers',
    })
  })

  it('accepts valid settings and returns only the known fields', () => {
    const input = { ...RETENTION_DEFAULTS, timeYears: 5, employeeDelete: 'off', extra: 1 }
    expect(checkRetentionSettings(input)).toEqual({ ...RETENTION_DEFAULTS, timeYears: 5, employeeDelete: 'off' })
  })

  it('accepts the range limits', () => {
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, timeYears: 1, assessmentYears: 40, cashYears: 30 }).cashYears).toBe(30)
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, cashYears: 1, employeeDelete: 'provider' }).employeeDelete).toBe('provider')
  })

  const invalid: [string, unknown][] = [
    ['not an object', null],
    ['years below 1', { ...RETENTION_DEFAULTS, timeYears: 0 }],
    ['years above 40', { ...RETENTION_DEFAULTS, paidOvertimeYears: 41 }],
    ['cash above 30', { ...RETENTION_DEFAULTS, cashYears: 31 }],
    ['cash below 1', { ...RETENTION_DEFAULTS, cashYears: 0 }],
    ['fractional years', { ...RETENTION_DEFAULTS, assessmentYears: 2.5 }],
    ['years as text', { ...RETENTION_DEFAULTS, timeYears: '2' }],
    ['NaN', { ...RETENTION_DEFAULTS, pensionYears: Number.NaN }],
    ['missing field', { timeYears: 2 }],
    ['unknown delete mode', { ...RETENTION_DEFAULTS, employeeDelete: 'everyone' }],
  ]
  it.each(invalid)('rejects %s with retention_settings_invalid', (_name, input) => {
    expect(() => checkRetentionSettings(input)).toThrow(RetentionSettingsError)
    try {
      checkRetentionSettings(input)
    } catch (error) {
      expect((error as RetentionSettingsError).code).toBe('retention_settings_invalid')
    }
  })
})
