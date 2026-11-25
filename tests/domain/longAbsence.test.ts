import { describe, expect, it } from 'vitest'
import { computeDay, computeRange, summarize } from '../../shared/domain/balance'
import { BW_RULES } from '../../shared/domain/holidays'
import {
  absentThroughout, checkLongAbsence, countsAsSick, joinSpans, longAbsenceReturnState, longSickDates, spansOfDates,
  type LongAbsencePeriod,
} from '../../shared/domain/longAbsence'
import { dailyTarget, isWorkday, longSickOn, type EmploymentInfo } from '../../shared/domain/targets'
import { dayWarnings, type CoverageRule, type EmployeeDay } from '../../shared/domain/warnings'
import { code, F1, S, shift } from '../helpers/entries'

const base: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }
const withAbsence = (...longAbsences: LongAbsencePeriod[]): EmploymentInfo => ({ ...base, longAbsences })

describe('checking a long absence', () => {
  it('refuses an end before the start and a day shared with another one (open ends included)', () => {
    expect(checkLongAbsence({ start: '2026-11-10', end: '2026-11-09' }, [])).toBe('end_before_start')
    expect(checkLongAbsence({ start: '2026-11-10', end: null }, [])).toBeNull()
    expect(checkLongAbsence({ start: '2026-11-10', end: '2026-11-20' }, [{ start: '2026-11-20', end: '2026-12-31' }])).toBe('overlap')
    expect(checkLongAbsence({ start: '2027-03-01', end: null }, [{ start: '2026-11-01', end: null }])).toBe('overlap')
    expect(checkLongAbsence({ start: '2026-10-01', end: null }, [{ start: '2026-11-01', end: '2026-11-30' }])).toBe('overlap')
    // Directly after another one is fine.
    expect(checkLongAbsence({ start: '2026-12-01', end: null }, [{ start: '2026-11-01', end: '2026-11-30' }])).toBeNull()
  })
})

describe('the sick days of a long absence', () => {
  it('counts Langzeitkrank and Kur/Reha on the days the caller accepts, not Sonstiges', () => {
    expect(countsAsSick('sick')).toBe(true)
    expect(countsAsSick('rehab')).toBe(true)
    expect(countsAsSick('other')).toBe(false)
    expect(countsAsSick('maternity')).toBe(false)
    const periods: LongAbsencePeriod[] = [
      { start: '2026-11-02', end: '2026-11-08', reason: 'sick' },
      { start: '2026-11-16', end: null, reason: 'rehab' },
      { start: '2026-11-09', end: '2026-11-13', reason: 'other' },
    ]
    const weekday = (date: string) => isWorkday(base, date)
    // Mon 02.11. – Fri 06.11. (the weekend is no working day), then from Mon 16.11. up to the range's end.
    expect(longSickDates(periods, '2026-11-01', '2026-11-18', weekday)).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-16', '2026-11-17', '2026-11-18',
    ])
    expect(longSickDates(periods, '2026-11-04', '2026-11-05', () => true)).toEqual(['2026-11-04', '2026-11-05'])
    expect(longSickDates(undefined, '2026-11-01', '2026-11-30', () => true)).toEqual([])
  })

  it('keeps the working days of Langzeitkrank and credits their target in the hours account, without an entry', () => {
    const info = withAbsence({ start: '2026-11-02', end: null, reason: 'sick' })
    expect(isWorkday(info, '2026-11-03')).toBe(true)
    expect(longSickOn(info, '2026-11-03')).toBe(true)
    expect(dailyTarget(info, '2026-11-03')).toBe(468)
    expect(computeDay(info, '2026-11-03', [])).toEqual({ date: '2026-11-03', target: 468, credit: 468, delta: 0 })
    // A duty left in the period does not earn overtime: the day counts as sick.
    expect(computeDay(info, '2026-11-03', [shift(1, '2026-11-03', ...S)]).delta).toBe(0)
    // A whole week: the target is met, nothing is missing.
    expect(summarize(computeRange(info, [], '2026-11-02', '2026-11-08'))).toEqual({ target: 2340, credit: 2340, delta: 0 })
    // Before the period the day is as always (no entry: the target is missing).
    expect(computeDay(info, '2026-10-30', []).delta).toBe(-468)
  })

  it('makes Sonstiges a time without working days and without target hours (unpaid)', () => {
    const info = withAbsence({ start: '2026-11-02', end: '2026-11-30', reason: 'other' })
    expect(isWorkday(info, '2026-11-03')).toBe(false)
    expect(longSickOn(info, '2026-11-03')).toBe(false)
    expect(computeDay(info, '2026-11-03', [])).toEqual({ date: '2026-11-03', target: 0, credit: 0, delta: 0 })
    expect(isWorkday(info, '2026-12-01')).toBe(true)
  })
})

describe('the spans the roster shows', () => {
  it('turns days into runs of consecutive days and joins spans of the same shown reason', () => {
    expect(spansOfDates(['2026-11-03', '2026-11-02', '2026-11-04', '2026-11-10', '2026-11-04'], 'maternity')).toEqual([
      { from: '2026-11-02', to: '2026-11-04', reason: 'maternity' },
      { from: '2026-11-10', to: '2026-11-10', reason: 'maternity' },
    ])
    // „abwesend“ (null) for Mutterschutz and Elternzeit right after it: one span, the change of reason is not told.
    expect(joinSpans([
      { from: '2027-01-12', to: '2028-01-11', reason: null },
      { from: '2026-10-01', to: '2027-01-11', reason: null },
    ])).toEqual([{ from: '2026-10-01', to: '2028-01-11', reason: null }])
    expect(joinSpans([
      { from: '2026-10-01', to: '2027-01-11', reason: 'maternity' },
      { from: '2027-01-12', to: '2028-01-11', reason: 'parental_leave' },
    ])).toHaveLength(2)
    expect(joinSpans([
      { from: '2026-10-01', to: null, reason: 'sick' },
      { from: '2026-12-01', to: '2026-12-31', reason: 'sick' },
    ])).toEqual([{ from: '2026-10-01', to: null, reason: 'sick' }])
    expect(joinSpans([
      { from: '2026-10-01', to: '2026-10-31', reason: 'sick' },
      { from: '2026-11-02', to: '2026-11-30', reason: 'sick' },
    ])).toHaveLength(2)
  })

  it('takes a person out of a range only when every working day is covered and no duty is planned', () => {
    const range = { from: '2026-11-01', to: '2026-11-30' }
    const days = ['2026-11-02', '2026-11-03', '2026-11-30']
    const open = [{ from: '2026-10-15', to: null, reason: 'sick' }]
    expect(absentThroughout(open, days, range, false)).toBe(true)
    expect(absentThroughout(open, days, range, true)).toBe(false)
    expect(absentThroughout([{ from: '2026-10-15', to: '2026-11-27', reason: 'sick' }], days, range, false)).toBe(false)
    expect(absentThroughout([], days, range, false)).toBe(false)
    // No working day in the range (e.g. weekends only): out when a span reaches into it.
    expect(absentThroughout(open, [], range, false)).toBe(true)
    expect(absentThroughout([{ from: '2026-12-01', to: null, reason: 'sick' }], [], range, false)).toBe(false)
  })

  it('reminds of the return from 14 days before the first working day after through that day', () => {
    expect(longAbsenceReturnState('2026-12-14', '2026-11-29')).toBeNull()
    expect(longAbsenceReturnState('2026-12-14', '2026-11-30')).toBe('upcoming')
    expect(longAbsenceReturnState('2026-12-14', '2026-12-14')).toBe('today')
    expect(longAbsenceReturnState('2026-12-14', '2026-12-15')).toBeNull()
  })
})

describe('the plan\'s warnings on a day of a long absence', () => {
  const date = '2026-11-03'
  const rules: CoverageRule[] = [{ id: 1, label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 1 }]
  const day = (employeeId: number, entries: EmployeeDay['entries'], longAbsence?: EmployeeDay['longAbsence']): EmployeeDay =>
    ({ employeeId, groupId: null, info: base, entries, ...(longAbsence ? { longAbsence } : {}) })

  it('misses no entry for someone away and does not count a duty left in an entered one, but names it', () => {
    const others = day(2, [shift(2, date, ...F1)])
    expect(dayWarnings(date, [day(1, [], 'stored'), others], rules, false, BW_RULES)).toEqual([])
    expect(dayWarnings(date, [day(1, [], 'derived'), others], rules, false, BW_RULES)).toEqual([])
    expect(dayWarnings(date, [day(1, []), others], rules, false, BW_RULES)).toEqual([{ type: 'missing_entry', date, employeeId: 1 }])
    // The only early duty lies in an entered long absence: the rule is not met, and the duty is named.
    expect(dayWarnings(date, [day(1, [shift(1, date, ...F1)], 'stored'), day(2, [code(2, date, 'vacation', 'daily_target')])], rules, false, BW_RULES))
      .toEqual([
        { type: 'coverage', date, ruleId: 1, label: 'Frühdienst ab 7:00', found: 0, required: 1 },
        { type: 'long_absence_duty', date, employeeId: 1 },
      ])
    // A duty planned anyway on a day of a booked Mutterschutz (e.g. chosen before the birth) counts as before.
    expect(dayWarnings(date, [day(1, [shift(1, date, ...F1)], 'derived'), day(2, [code(2, date, 'vacation', 'daily_target')])], rules, false, BW_RULES))
      .toEqual([])
  })
})
