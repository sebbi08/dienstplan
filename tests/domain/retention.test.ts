import { describe, expect, it } from 'vitest'
import {
  RETENTION_DEFAULTS, RetentionSettingsError, cashDeletableFrom, checkRetentionSettings, mayDeleteEmployeeByHand,
  retentionDueDates,
} from '../../shared/domain/retention'

describe('retentionDueDates', () => {
  it('uses the defaults for an employee who left on 2026-03-15', () => {
    expect(retentionDueDates('2026-03-15', RETENTION_DEFAULTS)).toEqual({
      immediate: '2026-03-16',
      time: '2029-01-01',
      assessment: '2030-01-01',
      paidOvertime: '2035-01-01',
      payroll: '2026-03-16',
    })
  })

  it('deletes Lohn und Steuer the day after leaving while a Lohnbüro keeps the records (the default)', () => {
    expect(retentionDueDates('2026-12-31', RETENTION_DEFAULTS).payroll).toBe('2027-01-01')
  })

  it('keeps Lohn und Steuer until 31.12. of the leaving year + 6 years without a Lohnbüro (§ 41 EStG, § 147 AO)', () => {
    const own = { ...RETENTION_DEFAULTS, payrollOffice: false }
    expect(retentionDueDates('2026-03-15', own).payroll).toBe('2033-01-01')
    expect(retentionDueDates('2026-12-31', own).payroll).toBe('2033-01-01')
    expect(retentionDueDates('2026-01-01', own).payroll).toBe('2033-01-01')
    // The other periods do not move.
    expect(retentionDueDates('2026-03-15', own).immediate).toBe('2026-03-16')
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
      timeYears: 2, assessmentYears: 3, paidOvertimeYears: 8, pensionYears: 30, cashYears: 10, bemYears: 3, maternityYears: 2, employeeDelete: 'managers',
      payrollOffice: true, infoVisitMonths: 12, applicantMonths: 6, openApplicantMonths: 12,
    })
  })

  it('takes „Lohnunterlagen bewahrt ein Lohnbüro auf“ as a yes or no', () => {
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, payrollOffice: false }).payrollOffice).toBe(false)
  })

  it('accepts valid settings and returns only the known fields', () => {
    const input = { ...RETENTION_DEFAULTS, timeYears: 5, employeeDelete: 'off', extra: 1 }
    expect(checkRetentionSettings(input)).toEqual({ ...RETENTION_DEFAULTS, timeYears: 5, employeeDelete: 'off' })
  })

  it('accepts the range limits', () => {
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, timeYears: 1, assessmentYears: 40, cashYears: 30 }).cashYears).toBe(30)
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, cashYears: 1, employeeDelete: 'provider' }).employeeDelete).toBe('provider')
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, infoVisitMonths: 60, applicantMonths: 24, openApplicantMonths: 60 }))
      .toMatchObject({ infoVisitMonths: 60, applicantMonths: 24, openApplicantMonths: 60 })
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, infoVisitMonths: 1, applicantMonths: 1, openApplicantMonths: 1 }))
      .toMatchObject({ infoVisitMonths: 1, applicantMonths: 1, openApplicantMonths: 1 })
  })

  const invalid: [string, unknown][] = [
    ['not an object', null],
    ['years below 1', { ...RETENTION_DEFAULTS, timeYears: 0 }],
    ['years above 40', { ...RETENTION_DEFAULTS, paidOvertimeYears: 41 }],
    ['cash above 30', { ...RETENTION_DEFAULTS, cashYears: 31 }],
    ['cash below 1', { ...RETENTION_DEFAULTS, cashYears: 0 }],
    ['BEM years below 1', { ...RETENTION_DEFAULTS, bemYears: 0 }],
    ['BEM years above 40', { ...RETENTION_DEFAULTS, bemYears: 41 }],
    ['BEM years missing', { ...RETENTION_DEFAULTS, bemYears: undefined }],
    ['Mutterschutz years below 1', { ...RETENTION_DEFAULTS, maternityYears: 0 }],
    ['Mutterschutz years missing', { ...RETENTION_DEFAULTS, maternityYears: undefined }],
    ['fractional years', { ...RETENTION_DEFAULTS, assessmentYears: 2.5 }],
    ['years as text', { ...RETENTION_DEFAULTS, timeYears: '2' }],
    ['NaN', { ...RETENTION_DEFAULTS, pensionYears: Number.NaN }],
    ['missing field', { timeYears: 2 }],
    ['unknown delete mode', { ...RETENTION_DEFAULTS, employeeDelete: 'everyone' }],
    ['payroll office as text', { ...RETENTION_DEFAULTS, payrollOffice: 'ja' }],
    ['payroll office missing', { ...RETENTION_DEFAULTS, payrollOffice: undefined }],
    ['info visit months below 1', { ...RETENTION_DEFAULTS, infoVisitMonths: 0 }],
    ['info visit months above 60', { ...RETENTION_DEFAULTS, infoVisitMonths: 61 }],
    ['open applicant months below 1', { ...RETENTION_DEFAULTS, openApplicantMonths: 0 }],
    ['open applicant months above 60', { ...RETENTION_DEFAULTS, openApplicantMonths: 61 }],
    ['applicant months above 24', { ...RETENTION_DEFAULTS, applicantMonths: 25 }],
    ['applicant months missing', { ...RETENTION_DEFAULTS, applicantMonths: undefined }],
  ]
  it.each(invalid)('rejects %s with retention_settings_invalid', (_name, input) => {
    expect(() => checkRetentionSettings(input)).toThrow(RetentionSettingsError)
    try {
      checkRetentionSettings(input)
    } catch (error) {
      expect((error as RetentionSettingsError).code).toBe('retention_settings_invalid')
    }
  })

  it('keeps „Ausgezahlte Überstunden, Verträge, Gehalt“ at least 8 years; a lower stored value stays and counts as 8', () => {
    const code = (fn: () => unknown) => {
      try {
        fn()
        return null
      }
      catch (error) {
        return (error as RetentionSettingsError).code
      }
    }
    expect(code(() => checkRetentionSettings({ ...RETENTION_DEFAULTS, paidOvertimeYears: 7 }))).toBe('retention_paid_overtime_too_short')
    expect(code(() => checkRetentionSettings({ ...RETENTION_DEFAULTS, paidOvertimeYears: 5 }, 6))).toBe('retention_paid_overtime_too_short')
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, paidOvertimeYears: 8 }).paidOvertimeYears).toBe(8)
    // Saved before the minimum and kept unchanged: still accepted (other periods can be saved).
    expect(checkRetentionSettings({ ...RETENTION_DEFAULTS, paidOvertimeYears: 5, timeYears: 3 }, 5)).toMatchObject({ paidOvertimeYears: 5, timeYears: 3 })
    expect(retentionDueDates('2026-03-15', { ...RETENTION_DEFAULTS, paidOvertimeYears: 5 }).paidOvertime).toBe('2035-01-01')
    expect(retentionDueDates('2026-03-15', { ...RETENTION_DEFAULTS, paidOvertimeYears: 12 }).paidOvertime).toBe('2039-01-01')
  })
})

describe('mayDeleteEmployeeByHand', () => {
  it('follows the Träger setting: aus nobody, nur Träger the Träger, Leitung und Träger both; Mitarbeiter never', () => {
    expect(mayDeleteEmployeeByHand('off', 'provider')).toBe(false)
    expect(mayDeleteEmployeeByHand('off', 'admin')).toBe(false)
    expect(mayDeleteEmployeeByHand('provider', 'provider')).toBe(true)
    expect(mayDeleteEmployeeByHand('provider', 'admin')).toBe(false)
    expect(mayDeleteEmployeeByHand('managers', 'provider')).toBe(true)
    expect(mayDeleteEmployeeByHand('managers', 'admin')).toBe(true)
    expect(mayDeleteEmployeeByHand('managers', 'observer')).toBe(false)
    expect(mayDeleteEmployeeByHand('managers', 'terminal')).toBe(false)
    expect(mayDeleteEmployeeByHand('managers', null)).toBe(false)
  })
})
