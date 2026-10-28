import { describe, expect, it } from 'vitest'
import {
  fullEmploymentMonths, hasSevereDisabilityIn, statutoryLeaveOf, statutoryMinimumLeave,
} from '../../shared/domain/statutoryLeave'
import { MONDAY_TO_FRIDAY } from '../../shared/domain/targets'

const MON_TO_THU = 0b0001111
const MON_TO_WED = 0b0000111

describe('statutoryMinimumLeave', () => {
  it('gives 24 Werktage per 6-day week for a full year', () => {
    const full = (workdaysPerWeek: number) => statutoryMinimumLeave({ workdaysPerWeek, year: 2026, employedFrom: '2020-03-01' })
    expect(full(5)).toEqual({ perYear: 20, inYear: 20 })
    expect(full(4)).toEqual({ perYear: 16, inYear: 16 })
    expect(full(3)).toEqual({ perYear: 12, inYear: 12 })
    expect(full(6)).toEqual({ perYear: 24, inYear: 24 })
    expect(full(2.5).perYear).toBe(10)
  })

  it('counts 1/12 per full month when joining during the year and keeps fractions under half a day', () => {
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-08-01' }).inYear).toBeCloseTo(8.33, 2)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-07-01' }).inYear).toBe(10)
    // 15 July: only August to December are full months.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-07-15' }).inYear).toBeCloseTo(8.33, 2)
    // 20 × 9 / 12 = 15; 16 × 7 / 12 = 9.33 stays; 12 × 5 / 12 = 5.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-04-01' }).inYear).toBe(15)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 4, year: 2026, employedFrom: '2026-06-01' }).inYear).toBeCloseTo(9.33, 2)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 3, year: 2026, employedFrom: '2026-08-01' }).inYear).toBe(5)
  })

  it('rounds a fraction of at least half a day up to a full day', () => {
    // 20 × 7 / 12 = 11.67 → 12.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-06-01' }).inYear).toBe(12)
    // 3 days, 2 months: 12 × 2 / 12 = 2 exactly.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 3, year: 2026, employedFrom: '2026-11-01' }).inYear).toBe(2)
    // 5 days, 1 month: 1.67 → 2.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-12-01' }).inYear).toBe(2)
  })

  it('counts the full months up to leaving during the year', () => {
    const leaving = (employedUntil: string) => statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2019-01-01', employedUntil }).inYear
    expect(leaving('2026-06-30')).toBe(10)
    expect(leaving('2026-06-15')).toBeCloseTo(8.33, 2)
    expect(leaving('2026-12-31')).toBe(20)
    // Joining and leaving in the same year: April to September.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-04-01', employedUntil: '2026-09-30' }).inYear).toBe(10)
  })

  it('gives nothing for a year outside the employment', () => {
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2027-01-01' }).inYear).toBe(0)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2020-01-01', employedUntil: '2025-12-31' }).inYear).toBe(0)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: null })).toEqual({ perYear: 20, inYear: 0 })
  })

  it('adds 5 days per 5-day week for a severe disability, with the same 1/12 rule', () => {
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2020-01-01', severeDisability: true })).toEqual({ perYear: 25, inYear: 25 })
    expect(statutoryMinimumLeave({ workdaysPerWeek: 4, year: 2026, employedFrom: '2020-01-01', severeDisability: true }).inYear).toBe(20)
    expect(statutoryMinimumLeave({ workdaysPerWeek: 3, year: 2026, employedFrom: '2020-01-01', severeDisability: true }).inYear).toBe(15)
    // 1 August: 8.33 + 2.08 (5 × 5 / 12, under half a day, stays).
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-08-01', severeDisability: true }).inYear).toBeCloseTo(10.42, 2)
    // 1 July: 10 + 2.5 → 3.
    expect(statutoryMinimumLeave({ workdaysPerWeek: 5, year: 2026, employedFrom: '2026-07-01', severeDisability: true }).inYear).toBe(13)
  })
})

describe('fullEmploymentMonths', () => {
  it('counts calendar months covered from the first to the last day', () => {
    expect(fullEmploymentMonths(2026, '2026-07-15')).toBe(5)
    expect(fullEmploymentMonths(2026, '2026-02-01', '2026-02-28')).toBe(1)
    expect(fullEmploymentMonths(2026, '2026-02-01', '2026-02-27')).toBe(0)
    expect(fullEmploymentMonths(2024, '2024-02-01', '2024-02-29')).toBe(1)
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
