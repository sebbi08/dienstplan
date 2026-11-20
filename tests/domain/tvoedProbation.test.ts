import { describe, expect, it } from 'vitest'
import {
  isAllowedPayGroup, isLegacyPayGroup, PAY_GROUPS, tvoedLeaveDays, tvoedLeaveDaysPerYear,
} from '../../shared/domain/tvoed'
import {
  isPlausibleProbationUntil, PROBATION_NOTICE_DAYS, probationHint, probationReminderState, probationRunning, suggestedProbationUntil,
} from '../../shared/domain/probation'

describe('TVöD SuE pay groups', () => {
  it('no longer offers S 10 (not in the table since 01.05.2026); S 5 and S 6 stay absent', () => {
    expect(PAY_GROUPS).not.toContain('S 10')
    expect(PAY_GROUPS).not.toContain('S 5')
    expect(PAY_GROUPS).not.toContain('S 6')
    expect(PAY_GROUPS).toContain('S 11a')
  })

  it('knows S 10 as an old stored value, accepted only while it is the one stored', () => {
    expect(isLegacyPayGroup('S 10')).toBe(true)
    expect(isLegacyPayGroup('S 8a')).toBe(false)
    expect(isAllowedPayGroup('S 8a', null)).toBe(true)
    expect(isAllowedPayGroup(null, 'S 10')).toBe(true)
    expect(isAllowedPayGroup('S 10', 'S 10')).toBe(true)
    expect(isAllowedPayGroup('S 10', 'S 8a')).toBe(false)
    expect(isAllowedPayGroup('S 10', null)).toBe(false)
    expect(isAllowedPayGroup('S 99', 'S 99')).toBe(false)
  })
})

describe('TVöD leave suggestion', () => {
  it('is 30 days for a 5-day week until 2026 and 31 days from 2027 (Tarifeinigung 06.04.2025)', () => {
    expect(tvoedLeaveDaysPerYear(2025)).toBe(30)
    expect(tvoedLeaveDaysPerYear(2026)).toBe(30)
    expect(tvoedLeaveDaysPerYear(2027)).toBe(31)
    expect(tvoedLeaveDaysPerYear(2030)).toBe(31)
    expect(tvoedLeaveDays(2026, 5)).toBe(30)
    expect(tvoedLeaveDays(2027, 5)).toBe(31)
  })

  it('follows the working days per week, a fraction of half a day or more rounded up (§ 26 Abs. 1 TVöD)', () => {
    expect(tvoedLeaveDays(2026, 4)).toBe(24)
    expect(tvoedLeaveDays(2026, 3)).toBe(18)
    expect(tvoedLeaveDays(2027, 4)).toBe(25) // 24,8
    expect(tvoedLeaveDays(2027, 3)).toBe(19) // 18,6
    expect(tvoedLeaveDays(2027, 1)).toBe(6) // 6,2
    expect(tvoedLeaveDays(2027, 6)).toBe(37) // 37,2
    expect(tvoedLeaveDays(2026, 0)).toBe(0)
  })
})

describe('Probezeit', () => {
  it('suggests six months minus a day after the start, four months for trainees (BBiG § 20)', () => {
    expect(suggestedProbationUntil('2026-03-01', null)).toBe('2026-08-31')
    expect(suggestedProbationUntil('2026-03-15', 'fachkraft')).toBe('2026-09-14')
    // 31 August + 6 months ends with February (§ 188 Abs. 3 BGB).
    expect(suggestedProbationUntil('2026-08-31', 'ergaenzung')).toBe('2027-02-28')
    expect(suggestedProbationUntil('2026-09-01', 'azubi_1')).toBe('2026-12-31')
    expect(suggestedProbationUntil('2026-09-01', 'azubi_3')).toBe('2026-12-31')
    // Studies are no training under the BBiG.
    expect(suggestedProbationUntil('2026-09-01', 'studium_1')).toBe('2027-02-28')
  })

  it('hints when longer than six months (§ 622 Abs. 3 BGB), never blocking', () => {
    expect(probationHint('2026-03-01', '2026-08-31', null)).toBeNull()
    expect(probationHint('2026-03-01', '2026-09-01', 'fachkraft')).toBe('tooLong')
    expect(probationHint('2026-03-01', '2026-02-28', null)).toBe('beforeStart')
    expect(probationHint(null, '2026-09-01', null)).toBeNull()
  })

  it('hints for trainees when longer than four months or shorter than one (BBiG § 20)', () => {
    expect(probationHint('2026-09-01', '2026-12-31', 'azubi_2')).toBeNull()
    expect(probationHint('2026-09-01', '2026-09-30', 'azubi_2')).toBeNull()
    expect(probationHint('2026-09-01', '2027-01-01', 'azubi_2')).toBe('traineeTooLong')
    expect(probationHint('2026-09-01', '2026-09-29', 'azubi_2')).toBe('traineeTooShort')
  })

  it('takes real dates from 1970 to 2100 only', () => {
    expect(isPlausibleProbationUntil('2026-08-31')).toBe(true)
    expect(isPlausibleProbationUntil('2026-02-30')).toBe(false)
    expect(isPlausibleProbationUntil('31.08.2026')).toBe(false)
    expect(isPlausibleProbationUntil('1969-12-31')).toBe(false)
  })

  it('runs until its last day', () => {
    expect(probationRunning('2026-12-31', '2026-12-31')).toBe(true)
    expect(probationRunning('2026-12-31', '2027-01-01')).toBe(false)
    expect(probationRunning(null, '2026-12-31')).toBe(false)
  })

  it('is reminded from 28 days before through the end date, none after', () => {
    expect(PROBATION_NOTICE_DAYS).toBe(28)
    expect(probationReminderState('2026-12-31', '2026-12-02')).toBeNull()
    expect(probationReminderState('2026-12-31', '2026-12-03')).toBe('upcoming')
    expect(probationReminderState('2026-12-31', '2026-12-30')).toBe('upcoming')
    expect(probationReminderState('2026-12-31', '2026-12-31')).toBe('today')
    expect(probationReminderState('2026-12-31', '2027-01-01')).toBeNull()
  })
})
