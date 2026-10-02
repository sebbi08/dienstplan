import { describe, expect, it } from 'vitest'
import { groupLeaveRanges, leaveAccount } from '../../shared/domain/leave'

describe('leaveAccount', () => {
  const dates = [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    '2026-10-10', // Saturday – ignored
    '2026-12-24', '2026-12-25', // 25th is a holiday – ignored
    '2025-12-30', // other year – ignored
    '2026-10-05', // duplicate – ignored
  ]
  it('splits taken and planned days around today', () => {
    expect(leaveAccount({ days: 30, carriedOverDays: 3 }, dates, 2026, '2026-10-07')).toEqual({
      entitlement: 30, carriedOver: 3, taken: 2, planned: 4, available: 27,
    })
  })
  it('works without an entitlement record', () => {
    expect(leaveAccount(null, ['2026-10-05'], 2026, '2026-10-01')).toEqual({
      entitlement: 0, carriedOver: 0, taken: 0, planned: 1, available: -1,
    })
  })
})

describe('groupLeaveRanges', () => {
  it('bridges weekends between leave days', () => {
    expect(groupLeaveRanges(['2026-10-13', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-20'])).toEqual([
      { from: '2026-10-08', to: '2026-10-13', days: 4 },
      { from: '2026-10-20', to: '2026-10-20', days: 1 },
    ])
  })
  it('bridges holidays between leave days', () => {
    expect(groupLeaveRanges(['2026-12-23', '2026-12-24', '2026-12-28'])).toEqual([
      { from: '2026-12-23', to: '2026-12-28', days: 3 },
    ])
  })
})

describe('leave on part-time working days', () => {
  const monToWed = (date: string) => ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13', '2026-10-14'].includes(date)

  it('counts only the working days of the employee', () => {
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
    expect(leaveAccount({ days: 18, carriedOverDays: 0 }, dates, 2026, '2026-10-01', monToWed).planned).toBe(3)
  })
  it('bridges the free days of the employee inside one period', () => {
    expect(groupLeaveRanges(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12'], monToWed)).toEqual([
      { from: '2026-10-05', to: '2026-10-12', days: 4 },
    ])
  })
})
