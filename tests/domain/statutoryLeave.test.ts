import { describe, expect, it } from 'vitest'
import {
  fullEmploymentMonths, hasSevereDisabilityIn, monthEnd, statutoryLeaveOf, statutoryMinimumLeave,
} from '../../shared/domain/statutoryLeave'
import { MONDAY_TO_FRIDAY } from '../../shared/domain/targets'

const MON_TO_THU = 0b0001111
const MON_TO_WED = 0b0000111

/** Days in 2026 for a 5-day week. */
const days2026 = (employedFrom: string, employedUntil: string | null = null, workdaysPerWeek = 5) =>
  statutoryMinimumLeave({ workdaysPerWeek, year: 2026, employedFrom, employedUntil }).inYear

describe('statutoryMinimumLeave', () => {
  it('gives 24 Werktage per 6-day week for a full year', () => {
    const full = (workdaysPerWeek: number) => statutoryMinimumLeave({ workdaysPerWeek, year: 2026, employedFrom: '2020-03-01' })
    expect(full(5)).toEqual({ perYear: 20, inYear: 20 })
    expect(full(4)).toEqual({ perYear: 16, inYear: 16 })
    expect(full(3)).toEqual({ perYear: 12, inYear: 12 })
    expect(full(6)).toEqual({ perYear: 24, inYear: 24 })
    expect(full(2.5).perYear).toBe(10)
  })

  it('gives the full year when the waiting period ends in the joining year (start on or before 1 July)', () => {
    expect(days2026('2026-01-01')).toBe(20)
    expect(days2026('2026-03-15')).toBe(20)
    expect(days2026('2026-07-01')).toBe(20)
    expect(days2026('2026-06-01', null, 4)).toBe(16)
  })

  it('counts 1/12 per full month from the start date after 1 July (§ 5 (1) a) and keeps fractions under half a day', () => {
    // 2 July: 2.7.–1.8. … 2.11.–1.12. are five full months by 31 December.
    expect(days2026('2026-07-02')).toBeCloseTo(8.33, 2)
    expect(days2026('2026-07-15')).toBeCloseTo(8.33, 2)
    expect(days2026('2026-08-01')).toBeCloseTo(8.33, 2)
    // 12 × 5 / 12 = 5.
    expect(days2026('2026-08-01', null, 3)).toBe(5)
  })

  it('rounds a fraction of at least half a day up to a full day', () => {
    // 16 × 5 / 12 = 6.67 → 7; 20 × 1 / 12 = 1.67 → 2; 12 × 2 / 12 = 2 exactly.
    expect(days2026('2026-08-01', null, 4)).toBe(7)
    expect(days2026('2026-12-01')).toBe(2)
    expect(days2026('2026-11-01', null, 3)).toBe(2)
  })

  it('counts 1/12 per full month when leaving in the first half after the waiting period (§ 5 (1) c)', () => {
    expect(days2026('2019-01-01', '2026-06-30')).toBe(10)
    expect(days2026('2019-01-01', '2026-06-15')).toBeCloseTo(8.33, 2)
    // Waiting period over on 30 June exactly, but leaving in the first half.
    expect(days2026('2026-01-01', '2026-06-30')).toBe(10)
  })

  it('gives the full year when leaving in the second half after the waiting period', () => {
    expect(days2026('2019-01-01', '2026-07-31')).toBe(20)
    expect(days2026('2019-01-01', '2026-07-01')).toBe(20)
    expect(days2026('2019-01-01', '2026-12-31')).toBe(20)
    // Joining and leaving in the same year: April to September completes the waiting period on 30 September.
    expect(days2026('2026-04-01', '2026-09-30')).toBe(20)
  })

  it('counts 1/12 per full month when leaving before the waiting period is over (§ 5 (1) b)', () => {
    // 1 February to 31 May: 4/12 = 6.67 → 7.
    expect(days2026('2026-02-01', '2026-05-31')).toBe(7)
    // 1 April to 29 September: one day short of the waiting period, five full months.
    expect(days2026('2026-04-01', '2026-09-29')).toBeCloseTo(8.33, 2)
    // Joined in the year before: the months of this year count from 1 January.
    expect(days2026('2025-11-01', '2026-02-28')).toBeCloseTo(3.33, 2)
  })

  it('gives nothing for a year outside the employment', () => {
    expect(days2026('2027-01-01')).toBe(0)
    expect(days2026('2020-01-01', '2025-12-31')).toBe(0)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: null })).toEqual({ perYear: 20, inYear: 0 })
  })

  it('adds 5 days per 5-day week for a severe disability, with the same 1/12 rule', () => {
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2020-01-01', severeDisability: true })).toEqual({ perYear: 25, inYear: 25 })
    expect(statutoryMinimumLeave({ workdaysPerWeek: 4, year: 2026, employedFrom: '2020-01-01', severeDisability: true }).inYear).toBe(20)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 3, year: 2026, employedFrom: '2020-01-01', severeDisability: true }).inYear).toBe(15)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-07-01', severeDisability: true }).inYear).toBe(25)
    // 1 August: 8.33 + 2.08 (5 × 5 / 12, under half a day, stays).
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-08-01', severeDisability: true }).inYear).toBeCloseTo(10.42, 2)
    // Leaving 30 June: 10 + 2.5 → 3.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2019-01-01', employedUntil: '2026-06-30', severeDisability: true }).inYear).toBe(13)
  })
})

describe('monthEnd and fullEmploymentMonths', () => {
  it('ends a month on the day before the same day, or on the last day of a shorter month', () => {
    expect(monthEnd('2026-07-15', 1)).toBe('2026-08-14')
    expect(monthEnd('2026-07-01', 6)).toBe('2026-12-31')
    expect(monthEnd('2026-07-02', 6)).toBe('2027-01-01')
    expect(monthEnd('2026-01-31', 1)).toBe('2026-02-28')
    expect(monthEnd('2024-01-31', 1)).toBe('2024-02-29')
    expect(monthEnd('2026-01-31', 2)).toBe('2026-03-30')
  })

  it('counts the full months from the start date', () => {
    expect(fullEmploymentMonths('2026-07-15', '2026-12-31')).toBe(5)
    expect(fullEmploymentMonths('2026-02-01', '2026-02-28')).toBe(1)
    expect(fullEmploymentMonths('2026-02-01', '2026-02-27')).toBe(0)
    expect(fullEmploymentMonths('2026-01-31', '2026-02-28')).toBe(1)
    expect(fullEmploymentMonths('2026-01-01', '2026-12-31')).toBe(12)
  })
})

describe('hasSevereDisabilityIn', () => {
  const file = { disability: true, disabilityEqual: false, disabilityUntil: null }
  it('counts only from the personnel file block the viewer was sent', () => {
    expect(hasSevereDisabilityIn(file, 2026)).toBe(true)
    // Without employees.sensitive the block is missing: the hint never includes the additional leave.
    expect(hasSevereDisabilityIn(undefined, 2026)).toBe(false)
  })
  it('leaves out „gleichgestellt“, no disability and a „gültig bis“ before the year', () => {
    expect(hasSevereDisabilityIn({ ...file, disability: false }, 2026)).toBe(false)
    expect(hasSevereDisabilityIn({ ...file, disabilityEqual: true }, 2026)).toBe(false)
    expect(hasSevereDisabilityIn({ ...file, disabilityUntil: '2025-12-31' }, 2026)).toBe(false)
    expect(hasSevereDisabilityIn({ ...file, disabilityUntil: '2026-03-31' }, 2026)).toBe(true)
  })
})

describe('statutoryLeaveOf', () => {
  it('takes the working days valid on 1 January, or at joining', () => {
    const employee = {
      hours: [
        { weeklyMinutes: 1950, validFrom: '2024-01-01', workdays: MONDAY_TO_FRIDAY },
        { weeklyMinutes: 1560, validFrom: '2026-01-01', workdays: MON_TO_THU },
        { weeklyMinutes: 1170, validFrom: '2026-06-01', workdays: MON_TO_WED },
      ],
      leftOn: null,
    }
    expect(statutoryLeaveOf(employee, 2025, false)).toEqual({ perYear: 20, inYear: 20 })
    expect(statutoryLeaveOf(employee, 2026, false)).toEqual({ perYear: 16, inYear: 16 })
    expect(statutoryLeaveOf(employee, 2027, false)).toEqual({ perYear: 12, inYear: 12 })
    expect(statutoryLeaveOf(employee, 2023, false).inYear).toBe(0)
  })

  it('uses the joining day and the leaving day', () => {
    const joined = { hours: [{ weeklyMinutes: 1560, validFrom: '2026-08-01', workdays: MON_TO_THU }], leftOn: null }
    // 16 × 5 / 12 = 6.67 → 7.
    expect(statutoryLeaveOf(joined, 2026, false)).toEqual({ perYear: 16, inYear: 7 })
    const leaving = { hours: [{ weeklyMinutes: 1950, validFrom: '2020-01-01' }], leftOn: '2026-03-31' }
    expect(statutoryLeaveOf(leaving, 2026, false).inYear).toBe(5)
    expect(statutoryLeaveOf(leaving, 2026, true).inYear).toBeCloseTo(6.25, 2)
  })
})
