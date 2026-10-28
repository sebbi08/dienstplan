import { describe, expect, it } from 'vitest'
import { BW_RULES } from '../../shared/domain/holidays'
import {
  countLeaveDays, countsAsLeaveDay, groupLeaveRanges, leaveAccount, leaveDaysThatFit, leaveDayWeight,
} from '../../shared/domain/leave'

/** Monday to Friday without the holidays of Baden-Württemberg. */
const bwLeaveDay = (date: string) => countsAsLeaveDay(date, BW_RULES)

describe('leaveAccount', () => {
  const dates = [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    '2026-10-10', // Saturday – ignored
    '2026-12-24', '2026-12-25', // 25th is a holiday – ignored
    '2025-12-30', // other year – ignored
    '2026-10-05', // duplicate – ignored
  ]
  it('splits taken and planned days around today', () => {
    expect(leaveAccount({ days: 30, carriedOverDays: 3 }, dates, 2026, '2026-10-07', bwLeaveDay)).toEqual({
      entitlement: 30, carriedOver: 3, taken: 2, planned: 4, available: 27,
    })
  })
  it('works without an entitlement record', () => {
    expect(leaveAccount(null, ['2026-10-05'], 2026, '2026-10-01', bwLeaveDay)).toEqual({
      entitlement: 0, carriedOver: 0, taken: 0, planned: 1, available: -1,
    })
  })
})

describe('groupLeaveRanges', () => {
  it('bridges weekends between leave days', () => {
    expect(groupLeaveRanges(['2026-10-13', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-20'], bwLeaveDay)).toEqual([
      { from: '2026-10-08', to: '2026-10-13', days: 4 },
      { from: '2026-10-20', to: '2026-10-20', days: 1 },
    ])
  })
  it('bridges holidays between leave days', () => {
    expect(groupLeaveRanges(['2026-12-23', '2026-12-24', '2026-12-28'], bwLeaveDay)).toEqual([
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

describe('24 and 31 December as half a leave day', () => {
  // Tuesday 22 December 2026 to Saturday 2 January 2027: 25/26 December and 1 January are holidays in BW, 26/27
  // December and 2 January weekend days. Leave days: 22, 23, 24, 28, 29, 30, 31 December.
  const christmas = ['2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28',
    '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']

  it('weighs 24 and 31 December with half a day only when the facility says so', () => {
    expect(leaveDayWeight('2026-12-24', true)).toBe(0.5)
    expect(leaveDayWeight('2025-12-31', true)).toBe(0.5)
    expect(leaveDayWeight('2026-12-23', true)).toBe(1)
    expect(leaveDayWeight('2027-01-01', true)).toBe(1)
    expect(leaveDayWeight('2026-12-24', false)).toBe(1)
    expect(leaveDayWeight('2026-12-31', false)).toBe(1)
  })

  it('counts the days with their weight', () => {
    expect(countLeaveDays(['2026-12-23', '2026-12-24', '2026-12-31'], true)).toBe(2)
    expect(countLeaveDays(['2026-12-23', '2026-12-24', '2026-12-31'], false)).toBe(3)
    expect(countLeaveDays([], true)).toBe(0)
  })

  it('counts the Christmas holidays as 6 instead of 7 days in the leave account', () => {
    expect(leaveAccount({ days: 30, carriedOverDays: 0 }, christmas, 2026, '2026-12-24', bwLeaveDay, true)).toEqual({
      entitlement: 30, carriedOver: 0, taken: 2, planned: 4, available: 24,
    })
    expect(leaveAccount({ days: 30, carriedOverDays: 0 }, christmas, 2026, '2026-12-24', bwLeaveDay, false)).toEqual({
      entitlement: 30, carriedOver: 0, taken: 2, planned: 5, available: 23,
    })
    // Without the setting the old call counts whole days.
    expect(leaveAccount({ days: 30, carriedOverDays: 0 }, christmas, 2026, '2026-12-24', bwLeaveDay).available).toBe(23)
  })

  it('gives the range over Christmas 6 days, and half a day for 24 December alone', () => {
    expect(groupLeaveRanges(christmas, bwLeaveDay, true)).toEqual([{ from: '2026-12-22', to: '2026-12-31', days: 6 }])
    expect(groupLeaveRanges(christmas, bwLeaveDay, false)).toEqual([{ from: '2026-12-22', to: '2026-12-31', days: 7 }])
    expect(groupLeaveRanges(['2026-12-24'], bwLeaveDay, true)).toEqual([{ from: '2026-12-24', to: '2026-12-24', days: 0.5 }])
  })

  it('fits as many days, in their order, as the leave left allows', () => {
    const dates = ['2026-12-23', '2026-12-24', '2026-12-28', '2026-12-31']
    expect(leaveDaysThatFit(dates, 2.5, true)).toBe(3)
    expect(leaveDaysThatFit(dates, 2.5, false)).toBe(2)
    expect(leaveDaysThatFit(dates, 2, true)).toBe(2)
    expect(leaveDaysThatFit(dates, 10, true)).toBe(4)
    expect(leaveDaysThatFit(dates, 0.5, true)).toBe(0)
    expect(leaveDaysThatFit(['2026-12-24', '2026-12-28'], 0.5, true)).toBe(1)
    expect(leaveDaysThatFit(dates, -3, true)).toBe(0)
  })
})
