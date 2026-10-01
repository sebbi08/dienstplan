import { describe, expect, it } from 'vitest'
import {
  balanceUntil, computeDay, computeRange, dayCredit, summarize, usesRecords, type ActualTime,
} from '../../shared/domain/balance'
import type { EmploymentInfo } from '../../shared/domain/targets'
import { code, F1, M, shift, special } from '../helpers/entries'

const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-10-05' }], leftOn: null }
const day = '2026-10-06'

describe('dayCredit', () => {
  it('sums net minutes of timed entries', () => {
    expect(dayCredit([shift(1, day, ...M)], 468)).toBe(465)
    expect(dayCredit([shift(1, day, ...F1)], 468)).toBe(375)
  })
  it('adds up several entries of one day (VZ + special shift)', () => {
    const entries = [code(1, day, 'prep_time', 'timed', 450, 570), special(1, day, 570, 870)]
    expect(dayCredit(entries, 468)).toBe(120 + 300)
  })
  it('credits the daily target for sick, even if a shift is also entered', () => {
    expect(dayCredit([shift(1, day, ...M), code(1, day, 'sick', 'daily_target')], 468)).toBe(468)
  })
  it('credits nothing for "other" without times but counts it with times', () => {
    expect(dayCredit([code(1, day, 'other', 'none')], 468)).toBe(0)
    expect(dayCredit([code(1, day, 'other', 'none', 600, 660)], 468)).toBe(60)
  })
  it('counts VZ inside a full shift only once', () => {
    expect(dayCredit([code(1, day, 'prep_time', 'timed', 840, 960), shift(1, day, ...M)], 468)).toBe(465)
  })
  it('adds only the part of VZ outside the shift', () => {
    expect(dayCredit([code(1, day, 'prep_time', 'timed', 420, 480), shift(1, day, ...M)], 468)).toBe(465 + 45)
  })
  it('still subtracts the shift break when VZ lies over it', () => {
    expect(dayCredit([code(1, day, 'prep_time', 'timed', 660, 780), shift(1, day, ...M)], 468)).toBe(465)
  })
  it('subtracts additional breaks', () => {
    const extraBreak = shift(1, day, 900, 915, null, null, { kind: 'break', countsAsStaff: false })
    expect(dayCredit([shift(1, day, ...M), extraBreak], 468)).toBe(450)
  })
})

describe('computeDay / computeRange', () => {
  it('counts weekend work fully as plus', () => {
    const saturday = '2026-10-10'
    expect(computeDay(info, saturday, [special(1, saturday, 840, 1080)]))
      .toEqual({ date: saturday, target: 0, credit: 240, delta: 240 })
  })
  it('sums a full week of M shifts for 39 h (−0:15)', () => {
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
    const entries = dates.map(date => shift(1, date, ...M))
    expect(summarize(computeRange(info, entries, '2026-10-05', '2026-10-11')))
      .toEqual({ target: 2340, credit: 2325, delta: -15 })
  })
  it('sums a week across the year boundary with Neujahr at target 0', () => {
    const yearInfo: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }
    const dates = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']
    const entries = dates.map(date => shift(1, date, ...M))
    const days = computeRange(yearInfo, entries, '2026-12-28', '2027-01-03')
    expect(days).toHaveLength(7)
    expect(days.find(d => d.date === '2027-01-01')?.target).toBe(0)
    expect(summarize(days)).toEqual({ target: 1872, credit: 1860, delta: -12 })
  })
})

describe('balanceUntil', () => {
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
  const entries = dates.map(date => shift(1, date, ...M))
  it('adds the opening balance and all daily deltas', () => {
    expect(balanceUntil(info, entries, [{ date: '2026-10-05', minutes: 750 }], '2026-10-09')).toBe(735)
  })
  it('only includes adjustments and days up to the given date', () => {
    expect(balanceUntil(info, entries, [{ date: '2026-10-05', minutes: 750 }], '2026-10-01')).toBe(0)
    expect(balanceUntil(info, entries, [], '2026-10-05')).toBe(-3)
  })
})

describe('recorded time (Zeiterfassung)', () => {
  const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }
  const actual = (minutes: Record<string, number>, from = '2026-10-01', today = '2026-10-08'): ActualTime =>
    ({ from, today, minutesByDate: new Map(Object.entries(minutes)) })
  const planned = [shift(1, '2026-10-06', ...M), shift(1, '2026-10-08', ...M)]

  it('uses records for days from the start date until yesterday', () => {
    expect(usesRecords(actual({}), '2026-10-07')).toBe(true)
    expect(usesRecords(actual({}), '2026-10-08')).toBe(false) // today: plan
    expect(usesRecords(actual({}), '2026-09-30')).toBe(false) // before the start date
    expect(usesRecords(undefined, '2026-10-07')).toBe(false)
  })
  it('credits recorded minutes instead of the plan for past days', () => {
    expect(computeDay(info, '2026-10-06', planned, actual({ '2026-10-06': 500 })).credit).toBe(500)
    expect(computeDay(info, '2026-10-07', [], actual({})).credit).toBe(0) // nothing recorded
    expect(computeDay(info, '2026-10-08', planned, actual({ '2026-10-08': 10 })).credit).toBe(465) // today: plan
  })
  it('keeps the daily target for absence codes even with records', () => {
    const sick = [code(1, '2026-10-06', 'sick', 'daily_target')]
    expect(computeDay(info, '2026-10-06', sick, actual({ '2026-10-06': 180 })).credit).toBe(468)
  })
  it('counts weekend records as plus', () => {
    expect(computeDay(info, '2026-10-04', [], actual({ '2026-10-04': 240 })).delta).toBe(240)
  })
  it('ignores records before the start date (start date moved later)', () => {
    expect(computeDay(info, '2026-10-06', planned, actual({ '2026-10-06': 500 }, '2026-10-07')).credit).toBe(465)
  })
  it('passes the records through computeRange and balanceUntil', () => {
    const records = actual({ '2026-10-06': 500 })
    expect(computeRange(info, planned, '2026-10-06', '2026-10-06', records)[0]!.credit).toBe(500)
    expect(balanceUntil(info, planned, [], '2026-10-06', records))
      .toBe(balanceUntil(info, planned, [], '2026-10-06') + (500 - 465))
  })
})
