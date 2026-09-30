import { describe, expect, it } from 'vitest'
import { balanceUntil, computeDay, computeRange, dayCredit, summarize } from '../../shared/domain/balance'
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
