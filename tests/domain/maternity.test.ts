import { describe, expect, it } from 'vitest'
import { dateRange } from '../../shared/domain/dates'
import type { HolidayRules } from '../../shared/domain/holidays'
import {
  banDates, isUnder18On, maternityDayWarnings, maternityDoubleWeekWarnings, maternityLastDay, maternityMonthWarning, maternityOpenOn,
  maternityPhaseOn, miscarriageProtectionDays, protectedAfterDates, protectionDates, protectionPeriods,
  type MaternityFacts,
} from '../../shared/domain/maternity'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { LawEntry } from '../../shared/domain/workingTimeLaw'

/** Bremen: no Epiphany (06.01.); Bavaria has it. */
const NO_HOLIDAYS: HolidayRules = { state: 'HB', assumptionDay: false }
const BAVARIA: HolidayRules = { state: 'BY', assumptionDay: true }

const facts = (values: Partial<MaternityFacts> = {}): MaternityFacts => ({
  notifiedOn: '2026-10-01', expectedBirth: '2027-03-15', actualBirth: null, extendedAfter: false, breastfeedingUntil: null,
  endedOn: null, miscarriageOn: null, miscarriageWeek: null, miscarriageWaived: false, ...values,
})

const shift = (start: number, end: number, breakStart: number | null = null, breakEnd: number | null = null): LawEntry =>
  ({ kind: 'shift', creditMode: 'timed', start, end, breakStart, breakEnd })

describe('Schutzfristen (§ 3 MuSchG)', () => {
  it('protects 6 weeks before the expected birth and 8 weeks after the birth day', () => {
    // 15.03.2027 − 42 days = 01.02.2027; the birth day and 8 weeks after it: 15.03.–10.05.2027 (99 days in all).
    expect(protectionPeriods(facts())).toEqual({
      birth: '2027-03-15', before: { from: '2027-02-01', to: '2027-03-14' }, after: { from: '2027-03-15', to: '2027-05-10' },
      carriedOver: 0, afterWeeks: 8, miscarriage: false,
    })
    expect(protectionDates(facts())).toHaveLength(99)
  })

  it('protects 12 weeks after a premature or multiple birth or a disabled child', () => {
    expect(protectionPeriods(facts({ extendedAfter: true })).after).toEqual({ from: '2027-03-15', to: '2027-06-07' })
    expect(protectionPeriods(facts({ extendedAfter: true })).afterWeeks).toBe(12)
  })

  it('adds the days not taken before an early birth after it (§ 3 Abs. 2 Satz 3)', () => {
    // Born on 01.03.: 28 days taken before, the other 14 come after the 8 weeks – the end stays 10.05.
    expect(protectionPeriods(facts({ actualBirth: '2027-03-01' }))).toEqual({
      birth: '2027-03-01', before: { from: '2027-02-01', to: '2027-02-28' }, after: { from: '2027-03-01', to: '2027-05-10' },
      carriedOver: 14, afterWeeks: 8, miscarriage: false,
    })
    // And on top of the 12 weeks.
    expect(protectionPeriods(facts({ actualBirth: '2027-03-01', extendedAfter: true })).after.to).toBe('2027-06-07')
    // Born before the protection period even began: all 42 days come after.
    expect(protectionPeriods(facts({ actualBirth: '2027-01-20' }))).toMatchObject({
      before: null, after: { from: '2027-01-20', to: '2027-04-28' }, carriedOver: 42,
    })
  })

  it('lets the period before run on until a late birth, the 8 weeks counting from the birth day', () => {
    expect(protectionPeriods(facts({ actualBirth: '2027-03-20' }))).toMatchObject({
      before: { from: '2027-02-01', to: '2027-03-19' }, after: { from: '2027-03-20', to: '2027-05-15' }, carriedOver: 0,
    })
  })
})

describe('when the rules apply', () => {
  it('from the notice to the end of the period after the birth, and through the breastfeeding time', () => {
    expect(maternityOpenOn(facts(), '2026-09-30')).toBe(false)
    expect(maternityOpenOn(facts(), '2026-10-01')).toBe(true)
    expect(maternityOpenOn(facts(), '2027-05-10')).toBe(true)
    expect(maternityOpenOn(facts(), '2027-05-11')).toBe(false)
    const nursing = facts({ breastfeedingUntil: '2027-09-30' })
    expect(maternityOpenOn(nursing, '2027-09-30')).toBe(true)
    expect(maternityOpenOn(nursing, '2027-10-01')).toBe(false)
    // An ended case (e.g. the employee left) stops after its last day.
    expect(maternityOpenOn(facts({ endedOn: '2026-12-31' }), '2027-01-01')).toBe(false)
  })

  it('names the phase: pregnancy before the birth, the period after it, then breastfeeding', () => {
    const nursing = facts({ actualBirth: '2027-03-10', breastfeedingUntil: '2027-09-30' })
    expect(maternityPhaseOn(nursing, '2027-03-09')).toBe('pregnancy')
    expect(maternityPhaseOn(nursing, '2027-03-10')).toBe('after')
    expect(maternityPhaseOn(nursing, '2027-06-01')).toBe('breastfeeding')
  })

  it('knows the under-18s from birthday and birth year (none without them)', () => {
    expect(isUnder18On('05-10', 2009, '2027-05-09')).toBe(true)
    expect(isUnder18On('05-10', 2009, '2027-05-10')).toBe(false)
    // Born on 29 February: 18 from 1 March in a common year.
    expect(isUnder18On('02-29', 2008, '2026-02-28')).toBe(true)
    expect(isUnder18On('02-29', 2008, '2026-03-01')).toBe(false)
    expect(isUnder18On(null, 2009, '2027-01-01')).toBe(false)
    expect(isUnder18On('05-10', null, '2027-01-01')).toBe(false)
  })
})

describe('a miscarriage (§ 3 Abs. 5 MuSchG)', () => {
  it('grades the protection by the week of pregnancy: from the 13th 2, from the 17th 6, from the 20th 8 weeks', () => {
    expect([12, 13, 16, 17, 19, 20, 30].map(miscarriageProtectionDays)).toEqual([0, 14, 14, 42, 42, 56, 56])
    expect(miscarriageProtectionDays(null)).toBe(0)
  })

  it('protects from the day of the miscarriage, unless the employee declined it, and ends the case there', () => {
    const lost = facts({ miscarriageOn: '2026-11-10', miscarriageWeek: 18 })
    expect(protectionPeriods(lost)).toEqual({
      birth: '2026-11-10', before: null, after: { from: '2026-11-10', to: '2026-12-22' }, carriedOver: 0, afterWeeks: 6, miscarriage: true,
    })
    expect(maternityLastDay(lost)).toBe('2026-12-22')
    expect(maternityPhaseOn(lost, '2026-11-20')).toBe('after')
    const declined = facts({ miscarriageOn: '2026-11-10', miscarriageWeek: 18, miscarriageWaived: true })
    expect(protectionPeriods(declined).after).toBeNull()
    expect(protectionDates(declined)).toEqual([])
    expect(maternityLastDay(declined)).toBe('2026-11-09')
    // Before the 13th week: no protection period.
    expect(protectionPeriods(facts({ miscarriageOn: '2026-10-20', miscarriageWeek: 11 })).after).toBeNull()
  })
})

describe('the days booked', () => {
  it('end with the case', () => {
    expect(protectionDates({ ...facts(), endedOn: '2027-02-10' }).at(-1)).toBe('2027-02-10')
    expect(protectedAfterDates(facts())[0]).toBe('2027-03-15')
  })

  it('of a full ban: until the protection period without an end, never on its days', () => {
    const ban = { ...facts(), employmentBan: 'full' as const, banFrom: '2027-01-25', banTo: null }
    expect(banDates(ban)).toEqual(dateRange('2027-01-25', '2027-01-31'))
    expect(banDates({ ...ban, banTo: '2027-02-05' })).toEqual(dateRange('2027-01-25', '2027-01-31'))
    expect(banDates({ ...ban, employmentBan: 'partial' })).toEqual([])
  })
})

describe('the plan hints of a day (§§ 4–6 MuSchG)', () => {
  const day = (date: string, entries: LawEntry[], options: Partial<Parameters<typeof maternityDayWarnings>[0]> = {}) =>
    maternityDayWarnings({ date, employeeId: 7, phase: 'pregnancy', under18: false, entries, previousEntries: [], holidays: NO_HOLIDAYS, ...options })
      .map(warning => ({ rule: warning.rule, value: warning.value, limit: warning.limit }))

  it('allows 8:30 h of work (8:00 h under 18), breaks not counted', () => {
    // Wednesday 18.11.2026.
    expect(day('2026-11-18', [shift(420, 960, 720, 750)])).toEqual([]) // 8:30 h
    expect(day('2026-11-18', [shift(420, 1000, 720, 750)])).toEqual([{ rule: 'hours', value: 550, limit: 510 }])
    expect(day('2026-11-18', [shift(420, 960, 720, 750)], { under18: true })).toEqual([{ rule: 'hours', value: 510, limit: 480 }])
  })

  it('flags work after 20:00 and before 6:00', () => {
    expect(day('2026-11-18', [shift(720, 1200)])).toEqual([])
    expect(day('2026-11-18', [shift(720, 1215)])).toEqual([{ rule: 'late', value: 1215, limit: 1200 }])
    expect(day('2026-11-18', [shift(345, 600)])).toEqual([{ rule: 'early', value: 345, limit: 360 }])
  })

  it('flags work on Sundays and public holidays', () => {
    expect(day('2026-11-22', [shift(540, 720)])).toEqual([{ rule: 'sunday', value: 180, limit: 0 }])
    // Saturday: no hint.
    expect(day('2026-11-21', [shift(540, 720)])).toEqual([])
    // 06.01.2027 (a Wednesday) is Epiphany in Bavaria, not in Bremen.
    expect(day('2027-01-06', [shift(540, 720)], { holidays: BAVARIA })).toEqual([{ rule: 'sunday', value: 180, limit: 0 }])
    expect(day('2027-01-06', [shift(540, 720)])).toEqual([])
  })

  it('flags less than 11 hours of rest after the day before', () => {
    expect(day('2026-11-18', [shift(420, 600)], { previousEntries: [shift(720, 1200)] })).toEqual([])
    expect(day('2026-11-18', [shift(405, 600)], { previousEntries: [shift(720, 1200)] })).toEqual([{ rule: 'rest', value: 645, limit: 660 }])
  })

  it('flags any work in the period after the birth instead of the limits (§ 3 Abs. 2: no employment)', () => {
    expect(day('2026-11-22', [shift(540, 900)], { phase: 'after' })).toEqual([{ rule: 'protected', value: 360, limit: 0 }])
  })

  it('flags any work on a day of a full ban', () => {
    expect(day('2026-11-18', [shift(540, 600)], { banned: true })).toEqual([{ rule: 'ban', value: 60, limit: 0 }])
  })

  it('has nothing to say about a day without work', () => {
    expect(day('2026-11-22', [{ kind: 'code', creditMode: 'daily_target', start: null, end: null, breakStart: null, breakEnd: null, codeKey: 'maternity' }])).toEqual([])
  })
})

describe('the monthly average (§ 4 Abs. 1 Satz 4 MuSchG)', () => {
  const info: EmploymentInfo = { hours: [{ weeklyMinutes: 30 * 60, validFrom: '2020-01-01' }], leftOn: null, holidays: NO_HOLIDAYS }
  const november = dateRange('2026-11-01', '2026-11-30')

  it('compares the work of the month with the contractual weekly hours as a monthly average', () => {
    // 30 h a week = 128:34 h in November; 6 h on each of the 21 weekdays = 126 h: fine.
    const six = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0 ? [] : [shift(480, 840)])
    expect(maternityMonthWarning({ employeeId: 7, dates: november, info, entriesOf: six, phase: 'pregnancy' })).toBeNull()
    // 6:30 h on each weekday = 136:30 h: Ø 31:51 h a week.
    const sixAndAHalf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0 ? [] : [shift(480, 870)])
    expect(maternityMonthWarning({ employeeId: 7, dates: november, info, entriesOf: sixAndAHalf, phase: 'pregnancy' })).toEqual({
      type: 'maternity', date: '2026-11-30', employeeId: 7, rule: 'average', value: 1911, limit: 1800, phase: 'pregnancy',
    })
  })

  it('counts only the days of the case (from the notice on)', () => {
    const days = november.slice(15)
    const long = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0 ? [] : [shift(420, 960, 720, 750)])
    expect(maternityMonthWarning({ employeeId: 7, dates: days, info, entriesOf: long, phase: 'pregnancy' }))
      .toMatchObject({ date: '2026-11-30', rule: 'average', limit: 1800 })
    expect(maternityMonthWarning({ employeeId: 7, dates: [], info, entriesOf: long, phase: 'pregnancy' })).toBeNull()
  })
})

describe('the double week (§ 4 Abs. 1 MuSchG: 90 h, under 18 80 h)', () => {
  const nine = () => [shift(420, 960)] // 9:00 h a day
  const check = (caseDays: string[], under18 = false) => maternityDoubleWeekWarnings({
    employeeId: 7, caseDays, from: '2026-11-01', to: '2026-11-30', entriesOf: nine, under18On: () => under18, phaseOf: () => 'pregnancy',
  }).map(warning => `${warning.date} ${warning.value}/${warning.limit}`)

  it('sums each double week starting on a Monday whose last day lies in the month', () => {
    // Ten working days of 9 h (Mon 02.11.–Fri 13.11.): exactly 90 h is allowed.
    const tenDays = dateRange('2026-11-02', '2026-11-13').filter(date => new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0)
    expect(check(tenDays)).toEqual([])
    // Plus Saturday 14.11.: 99 h.
    expect(check([...tenDays, '2026-11-14'])).toEqual(['2026-11-14 5940/5400'])
    // Under 18 the ten days are already too much.
    expect(check(tenDays, true)).toEqual(['2026-11-13 5400/4800'])
  })

  it('counts the days before the month for a double week ending in it', () => {
    // Mon 26.10.–Sun 08.11.: its last day lies in November.
    const days = dateRange('2026-10-26', '2026-11-08')
    expect(check(days)).toEqual(['2026-11-08 7560/5400'])
  })
})
