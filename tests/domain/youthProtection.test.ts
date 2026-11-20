import { describe, expect, it } from 'vitest'
import type { DomainEntry, IsoDate } from '../../shared/domain/types'
import { ackKeyDate, warningAckKey, warningSignature } from '../../shared/domain/warningList'
import {
  ageOn, averageDailyMinutes, birthdayUncertainOn, isMinorOn, minorStatusOn, needsBirthYear, youthExamStatus, youthFollowupBanFrom,
  youthFollowupBanOn, youthLeaveOf, youthLeaveWerktage, youthMinimumLeave, youthWarnings, type YouthRule, type YouthWarning,
} from '../../shared/domain/youthProtection'
import { code, shift, special } from '../helpers/entries'

const HOLIDAYS = { state: 'NW', assumptionDay: false } as const

/** Monday 2026-11-16 … Sunday 2026-11-22. */
const MON = '2026-11-16'
const TUE = '2026-11-17'
const WED = '2026-11-18'
const THU = '2026-11-19'
const FRI = '2026-11-20'
const SAT = '2026-11-21'
const SUN = '2026-11-22'
const WEEK = [MON, TUE, WED, THU, FRI]

/** The hints of the week of 16 November 2026 for the planned entries per day (every day counts). */
function check(
  plan: Record<IsoDate, DomainEntry[]>,
  options: { appliesOn?: (date: IsoDate) => boolean; from?: IsoDate; to?: IsoDate; creditOn?: (date: IsoDate) => number } = {},
) {
  return youthWarnings({
    employeeId: 1, from: options.from ?? MON, to: options.to ?? SUN, holidays: HOLIDAYS,
    entriesOf: date => plan[date] ?? [], appliesOn: options.appliesOn ?? (() => true), creditOn: options.creditOn,
  })
}
const rules = (warnings: YouthWarning[]) => warnings.map(warning => [warning.rule, warning.date, warning.value, warning.limit])
const only = (warnings: YouthWarning[], rule: YouthRule) => rules(warnings.filter(warning => warning.rule === rule))
/** A day 8:00–8:00+minutes with a 60 min break from 12:00 (work ends later by the break). */
const day = (date: IsoDate, minutes: number) => shift(1, date, 480, 480 + minutes + 60, 720, 780)
const school = (date: IsoDate, start: number | null = null, end: number | null = null) => code(1, date, 'school', 'daily_target', start, end)

describe('age', () => {
  it('is under 18 up to the day before the 18th birthday', () => {
    expect(ageOn('05-10', 2009, '2027-05-09')).toBe(17)
    expect(ageOn('05-10', 2009, '2027-05-10')).toBe(18)
    expect(isMinorOn('05-10', 2009, '2027-05-09')).toBe(true)
    expect(isMinorOn('05-10', 2009, '2027-05-10')).toBe(false)
    // Born on 29 February: 18 from 1 March in a common year.
    expect(isMinorOn('02-29', 2008, '2026-02-28')).toBe(true)
    expect(isMinorOn('02-29', 2008, '2026-03-01')).toBe(false)
  })
  it('needs the full birth date for the age', () => {
    expect(ageOn(null, 2009, '2026-01-01')).toBeNull()
    expect(ageOn('05-10', null, '2026-01-01')).toBeNull()
    expect(isMinorOn('05-10', null, '2026-01-01')).toBe(false)
    expect(minorStatusOn('05-10', null, '2026-01-01')).toBe('unknown')
    expect(birthdayUncertainOn('05-10', null, '2026-01-01')).toBe(false)
  })
  it('tells from the birth year alone while the year of the day is at most 17 or at least 19 years later', () => {
    expect(minorStatusOn(null, 2009, '2026-12-31')).toBe('minor')
    expect(isMinorOn(null, 2009, '2026-12-31')).toBe(true)
    // The year of the 18th birthday: unknown, the Leitung gets „Geburtstag fehlt“.
    expect(minorStatusOn(null, 2009, '2027-01-01')).toBe('unknown')
    expect(isMinorOn(null, 2009, '2027-06-30')).toBe(false)
    expect(birthdayUncertainOn(null, 2009, '2027-06-30')).toBe(true)
    expect(minorStatusOn(null, 2009, '2028-01-01')).toBe('adult')
    expect(birthdayUncertainOn(null, 2009, '2028-01-01')).toBe(false)
    expect(birthdayUncertainOn(null, 2009, '2026-12-31')).toBe(false)
    // With the birthday the full date decides.
    expect(birthdayUncertainOn('05-10', 2009, '2027-01-01')).toBe(false)
  })
  it('asks for the birth year of trainees, students, interns and staff without a pedagogic qualification', () => {
    for (const qualification of ['azubi_1', 'azubi_2', 'azubi_3', 'studium_1', 'studium_2', 'studium_3', 'praktikant', 'none'] as const) {
      expect(needsBirthYear(qualification), qualification).toBe(true)
    }
    for (const qualification of ['fachkraft', 'ergaenzung', 'haushalt', null] as const) expect(needsBirthYear(qualification)).toBe(false)
  })
})

describe('§ 8 JArbSchG: 8 hours a day, 40 hours a week', () => {
  it('allows exactly 8:00 h and warns from 8:01 h', () => {
    expect(check({ [MON]: [day(MON, 480)] })).toEqual([])
    expect(rules(check({ [MON]: [day(MON, 481)] }))).toEqual([['hours', MON, 481, 480]])
  })
  it('allows up to 8:30 h when another workday of the week is shorter than 8 h', () => {
    const plan = { [MON]: [day(MON, 510)], [TUE]: [day(TUE, 420)], [WED]: [day(WED, 480)] }
    expect(only(check(plan), 'hours')).toEqual([])
    expect(only(check({ ...plan, [MON]: [day(MON, 511)] }), 'hours')).toEqual([['hours', MON, 511, 510]])
    // Without a shorter day (a free day is not shortened) 8:00 h stay the limit.
    expect(only(check({ [MON]: [day(MON, 510)], [WED]: [day(WED, 480)] }), 'hours')).toEqual([['hours', MON, 510, 480]])
    // A shorter Sunday does not count: Werktage are Monday to Saturday.
    expect(only(check({ [MON]: [day(MON, 510)], [SUN]: [special(1, SUN, 600, 700)] }), 'hours')).toEqual([['hours', MON, 510, 480]])
  })
  it('warns on the day the week passes 40 hours, with the week total', () => {
    const plan = Object.fromEntries(WEEK.map(date => [date, [day(date, 480)]]))
    expect(check(plan)).toEqual([])
    plan[FRI] = [day(FRI, 420)]
    plan[SAT] = [special(1, SAT, 600, 661)]
    expect(only(check(plan), 'week')).toEqual([['week', SAT, 2401, 2400]])
  })
  it('counts school with times, its breaks included, as working time for the day and the week', () => {
    const plan = Object.fromEntries(WEEK.map(date => [date, [day(date, 480)]]))
    plan[FRI] = [school(FRI, 480, 660), special(1, FRI, 720, 1021)] // 3:00 h school + 5:01 h work
    expect(only(check(plan), 'week')).toEqual([['week', FRI, 2401, 2400]])
    // 8:00–12:00 with a 20 min break in the entry: 4:00 h; with 4:01 h of work after it more than 8 h.
    const withBreak = { ...school(MON, 480, 720), breakStart: 600, breakEnd: 620 }
    expect(only(check({ [MON]: [withBreak, special(1, MON, 780, 1021)] }), 'hours')).toEqual([['hours', MON, 481, 480]])
  })
})

describe('§ 15 JArbSchG: five days a week', () => {
  it('warns on the sixth day with work or school', () => {
    const plan: Record<IsoDate, DomainEntry[]> = Object.fromEntries(WEEK.map(date => [date, [special(1, date, 480, 720)]]))
    expect(only(check(plan), 'days')).toEqual([])
    plan[WED] = [school(WED)]
    plan[SAT] = [special(1, SAT, 480, 600)]
    expect(only(check(plan), 'days')).toEqual([['days', SAT, 6, 5]])
    plan[SUN] = [special(1, SUN, 480, 600)]
    expect(only(check(plan), 'days')).toEqual([['days', SAT, 7, 5]])
  })
  it('does not count whole-day absences', () => {
    const plan: Record<IsoDate, DomainEntry[]> = Object.fromEntries(WEEK.map(date => [date, [special(1, date, 480, 720)]]))
    plan[MON] = [code(1, MON, 'vacation', 'daily_target')]
    plan[SAT] = [special(1, SAT, 480, 600)]
    expect(only(check(plan), 'days')).toEqual([])
  })
})

describe('§ 14 JArbSchG: from 6 to 20 o\'clock', () => {
  it('warns of work before 6:00 and after 20:00', () => {
    expect(check({ [MON]: [special(1, MON, 360, 600)], [TUE]: [special(1, TUE, 960, 1200)] })).toEqual([])
    expect(rules(check({ [MON]: [special(1, MON, 359, 600)], [TUE]: [special(1, TUE, 960, 1201)] })))
      .toEqual([['early', MON, 359, 360], ['late', TUE, 1201, 1200]])
  })
  it('does not count school as work for these hours', () => {
    expect(only(check({ [MON]: [school(MON, 1080, 1260)] }), 'late')).toEqual([])
    expect(only(check({ [MON]: [school(MON, 1080, 1260), special(1, MON, 600, 840)] }), 'late')).toEqual([])
  })
})

describe('§§ 16–18 JArbSchG: Saturday, Sunday, public holiday', () => {
  it('hints at work on these days', () => {
    expect(rules(check({ [SAT]: [special(1, SAT, 480, 600)], [SUN]: [special(1, SUN, 480, 600)] })))
      .toEqual([['saturday', SAT, 120, 0], ['sunday', SUN, 120, 0]])
    // 25 December 2026 is a Friday.
    const christmas = '2026-12-25'
    expect(rules(youthWarnings({
      employeeId: 1, from: '2026-12-21', to: '2026-12-27', holidays: HOLIDAYS, appliesOn: () => true,
      entriesOf: date => (date === christmas ? [special(1, christmas, 480, 600)] : []),
    }))).toEqual([['holiday', christmas, 120, 0]])
  })
  it('stays quiet on a weekend without work, school included', () => {
    expect(check({ [SAT]: [code(1, SAT, 'vacation', 'daily_target')] })).toEqual([])
    expect(check({ [SAT]: [school(SAT, 480, 720)] })).toEqual([])
  })
  it('hints at work after 14:00 on 24 and 31 December', () => {
    const eves = (plan: Record<IsoDate, DomainEntry[]>) => rules(youthWarnings({
      employeeId: 1, from: '2026-12-21', to: '2027-01-03', holidays: HOLIDAYS, appliesOn: () => true, entriesOf: date => plan[date] ?? [],
    }).filter(warning => warning.rule === 'eve'))
    // 24 and 31 December 2026 are Thursdays.
    expect(eves({ '2026-12-24': [special(1, '2026-12-24', 600, 840)], '2026-12-31': [special(1, '2026-12-31', 600, 840)] })).toEqual([])
    expect(eves({ '2026-12-24': [special(1, '2026-12-24', 600, 841)], '2026-12-31': [special(1, '2026-12-31', 720, 960)] }))
      .toEqual([['eve', '2026-12-24', 841, 840], ['eve', '2026-12-31', 960, 840]])
    expect(eves({ '2026-12-23': [special(1, '2026-12-23', 720, 960)] })).toEqual([])
  })
})

describe('§ 13 JArbSchG: 12 hours of free time', () => {
  it('warns of less than 12 hours between two working days', () => {
    expect(only(check({ [MON]: [special(1, MON, 600, 1080)], [TUE]: [special(1, TUE, 360, 600)] }), 'rest')).toEqual([])
    expect(only(check({ [MON]: [special(1, MON, 600, 1140)], [TUE]: [special(1, TUE, 420, 600)] }), 'rest')).toEqual([])
    expect(only(check({ [MON]: [special(1, MON, 600, 1140)], [TUE]: [special(1, TUE, 419, 600)] }), 'rest'))
      .toEqual([['rest', TUE, 719, 720]])
  })
  it('takes the day before the range for its first day', () => {
    expect(only(check({ '2026-11-15': [special(1, '2026-11-15', 900, 1140)], [MON]: [special(1, MON, 419, 600)] }), 'rest'))
      .toEqual([['rest', MON, 719, 720]])
  })
})

describe('§ 11 JArbSchG: breaks', () => {
  it('needs 30 minutes from more than 4:30 h and 60 minutes from more than 6:00 h', () => {
    expect(check({ [MON]: [special(1, MON, 480, 750)] })).toEqual([]) // 4:30 h
    expect(only(check({ [MON]: [special(1, MON, 480, 751)] }), 'break')).toEqual([['break', MON, 0, 30]])
    expect(only(check({ [MON]: [shift(1, MON, 480, 870, 660, 690)] }), 'break')).toEqual([]) // 6:00 h, 30 min
    expect(only(check({ [MON]: [shift(1, MON, 480, 871, 660, 690)] }), 'break')).toEqual([['break', MON, 30, 60]])
    expect(only(check({ [MON]: [shift(1, MON, 480, 900, 660, 720)] }), 'break')).toEqual([])
  })
  it('counts only breaks of at least 15 minutes, additional breaks and gaps between entries included', () => {
    const breakEntry = (start: number, end: number): DomainEntry => ({ ...special(1, MON, start, end), kind: 'break' })
    expect(only(check({ [MON]: [special(1, MON, 480, 900), breakEntry(600, 615), breakEntry(720, 765)] }), 'break')).toEqual([])
    expect(only(check({ [MON]: [special(1, MON, 480, 900), breakEntry(600, 614), breakEntry(720, 765)] }), 'break'))
      .toEqual([['break', MON, 45, 60]])
    expect(only(check({ [MON]: [special(1, MON, 480, 690), special(1, MON, 720, 900)] }), 'break')).toEqual([['break', MON, 30, 60]])
  })
  it('warns of more than 4:30 h without a break, short interruptions included', () => {
    expect(only(check({ [MON]: [shift(1, MON, 480, 870, 750, 810)] }), 'stretch')).toEqual([])
    expect(only(check({ [MON]: [shift(1, MON, 480, 870, 751, 811)] }), 'stretch')).toEqual([['stretch', MON, 271, 270]])
    // A gap of 10 minutes is no break: 8:00–10:00 and 10:10–12:40 are one stretch of 4:40 h.
    expect(only(check({ [MON]: [special(1, MON, 480, 600), special(1, MON, 610, 760), special(1, MON, 820, 900)] }), 'stretch'))
      .toEqual([['stretch', MON, 280, 270]])
  })
})

describe('§ 9 JArbSchG: Berufsschule', () => {
  it('allows no work on a long school day (more than 5 lessons; without times always long)', () => {
    // 8:00–12:30 is 270 minutes of lessons, six of 45 minutes: a long day.
    expect(only(check({ [MON]: [school(MON, 480, 750), special(1, MON, 780, 960)] }), 'schoolDay')).toEqual([['schoolDay', MON, 180, 0]])
    expect(only(check({ [MON]: [school(MON, 480, 749), special(1, MON, 780, 960)] }), 'schoolDay')).toEqual([])
    // The break of the entry is no lesson.
    const withBreak = { ...school(MON, 480, 780), breakStart: 600, breakEnd: 631 }
    expect(only(check({ [MON]: [withBreak, special(1, MON, 810, 960)] }), 'schoolDay')).toEqual([])
    expect(only(check({ [MON]: [school(MON), special(1, MON, 780, 960)] }), 'schoolDay')).toEqual([['schoolDay', MON, 180, 0]])
  })
  it('needs only one long school day of the week free of work', () => {
    expect(only(check({ [MON]: [school(MON)], [TUE]: [school(TUE), special(1, TUE, 780, 960)] }), 'schoolDay')).toEqual([])
    expect(only(check({ [MON]: [school(MON), special(1, MON, 780, 960)], [TUE]: [school(TUE)] }), 'schoolDay')).toEqual([])
    // Both with work: the hint on the first.
    expect(only(check({ [MON]: [school(MON), special(1, MON, 780, 960)], [TUE]: [school(TUE), special(1, TUE, 780, 900)] }), 'schoolDay'))
      .toEqual([['schoolDay', MON, 180, 0]])
  })
  it('counts a long school day with the average daily working time for the week, once', () => {
    const plan: Record<IsoDate, DomainEntry[]> = { [MON]: [school(MON, 480, 780)] } // 5:00 h of school count 8:00 h
    for (const date of [TUE, WED, THU, FRI]) plan[date] = [day(date, 480)]
    plan[SAT] = [special(1, SAT, 600, 601)]
    expect(only(check(plan), 'week')).toEqual([['week', SAT, 2401, 2400]])
    // 39 hours on 5 days: the school day counts 7:48 h, so the week has 39:49 h.
    expect(only(check(plan, { creditOn: () => 468 }), 'week')).toEqual([])
    plan[SAT] = [special(1, SAT, 600, 613)]
    expect(only(check(plan, { creditOn: () => 468 }), 'week')).toEqual([['week', SAT, 2401, 2400]])
  })
  it('takes the average daily working time from the contract, 8 hours without one', () => {
    const info = (weeklyMinutes: number, workdays: number) => ({ hours: [{ weeklyMinutes, validFrom: '2026-01-01', workdays }], leftOn: null, holidays: HOLIDAYS })
    expect(averageDailyMinutes(info(2340, 0b0011111), MON)).toBe(468)
    expect(averageDailyMinutes(info(1200, 0b0000111), MON)).toBe(400)
    expect(averageDailyMinutes({ hours: [], leftOn: null, holidays: HOLIDAYS }, MON)).toBe(480)
  })
  it('allows no work before lessons that start before 9:00', () => {
    expect(only(check({ [MON]: [special(1, MON, 420, 470), school(MON, 525, 700)] }), 'schoolBefore')).toEqual([['schoolBefore', MON, 420, 525]])
    expect(only(check({ [MON]: [special(1, MON, 420, 520), school(MON, 540, 700)] }), 'schoolBefore')).toEqual([])
    // Work after school on a short school day is allowed.
    expect(only(check({ [MON]: [school(MON, 480, 700), special(1, MON, 780, 900)] }), 'schoolBefore')).toEqual([])
  })
  it('leaves school out of the breaks', () => {
    expect(only(check({ [MON]: [school(MON, 480, 780), special(1, MON, 840, 1000)] }), 'stretch')).toEqual([])
    expect(only(check({ [MON]: [school(MON, 480, 780), special(1, MON, 840, 1000)] }), 'break')).toEqual([])
  })
})

describe('which days are checked', () => {
  it('checks only the days the rules apply on (under 18 and employed), within the range', () => {
    const plan = { [MON]: [day(MON, 540)], [TUE]: [day(TUE, 540)] }
    expect(only(check(plan, { appliesOn: date => date < TUE }), 'hours')).toEqual([['hours', MON, 540, 480]])
    expect(only(check(plan, { from: TUE }), 'hours')).toEqual([['hours', TUE, 540, 480]])
    expect(check(plan, { appliesOn: () => false })).toEqual([])
  })
  it('gives a key per rule that can be acknowledged', () => {
    const warning = check({ [MON]: [day(MON, 540)] }).find(item => item.rule === 'hours')!
    expect(warningAckKey(warning)).toBe(`youth|${MON}|1|hours`)
    expect(warningSignature(warning)).toBe('540/480')
    expect(ackKeyDate(warningAckKey(warning))).toBe(MON)
    expect(ackKeyDate(`youth|${MON}|1|nonsense`)).toBeNull()
    expect(ackKeyDate(`youth_birth_year|${MON}|1`)).toBe(MON)
  })
})

describe('§ 19 JArbSchG: minimum leave', () => {
  it('gives 30, 27 and 25 Werktage by the age at the start of the year', () => {
    expect(youthLeaveWerktage(15)).toBe(30)
    expect(youthLeaveWerktage(16)).toBe(27)
    expect(youthLeaveWerktage(17)).toBe(25)
    expect(youthLeaveWerktage(18)).toBeNull()
  })
  it('converts to the workdays per week, rounded up to half days', () => {
    const leave = (birthday: string, birthYear: number, workdaysPerWeek = 5) =>
      youthMinimumLeave({ birthday, birthYear, year: 2026, workdaysPerWeek, employedFrom: '2025-08-01' })
    // 15 on 1 January 2026.
    expect(leave('03-01', 2010)).toEqual({ perYear: 25, inYear: 25 })
    // Born on 1 January: 16 at the start of the year.
    expect(leave('01-01', 2010)).toEqual({ perYear: 22.5, inYear: 22.5 })
    expect(leave('01-02', 2009)).toEqual({ perYear: 22.5, inYear: 22.5 })
    expect(leave('01-02', 2009, 4)).toEqual({ perYear: 18, inYear: 18 })
    // 17: 25 × 5 / 6 = 20.83 → 21; 25 × 4 / 6 = 16.67 → 17; 25 × 3 / 6 = 12.5.
    expect(leave('06-01', 2008)).toEqual({ perYear: 21, inYear: 21 })
    expect(leave('06-01', 2008, 4).perYear).toBe(17)
    expect(leave('06-01', 2008, 3).perYear).toBe(12.5)
    // 18 at the start of the year: no youth minimum, even when the birthday is on 1 January.
    expect(leave('01-01', 2008)).toBeNull()
    expect(youthMinimumLeave({ birthday: '03-01', birthYear: null, year: 2026, workdaysPerWeek: 5, employedFrom: '2025-08-01' })).toBeNull()
  })
  it('takes the birth year alone when it is certain, as year − birth year − 1', () => {
    const yearOnly = (birthYear: number) => youthMinimumLeave({ birthday: null, birthYear, year: 2026, workdaysPerWeek: 5, employedFrom: '2025-08-01' })
    expect(yearOnly(2010)).toEqual({ perYear: 25, inYear: 25 }) // 15: 30 Werktage
    expect(yearOnly(2009)).toEqual({ perYear: 22.5, inYear: 22.5 }) // 16: 27 Werktage
    // In the year of the 18th birthday it is unknown: no youth minimum.
    expect(yearOnly(2008)).toBeNull()
  })
  it('counts twelfths for a start in the second half of the year, as the statutory hint', () => {
    // Joining on 1 August 2026: five full months → 25 × 5 / 12 = 10.42 days, kept under half a day.
    expect(youthMinimumLeave({ birthday: '03-01', birthYear: 2010, year: 2026, workdaysPerWeek: 5, employedFrom: '2026-08-01' }))
      .toEqual({ perYear: 25, inYear: 10.42 })
  })
  it('takes the workdays of the employee\'s hours on 1 January', () => {
    const employee = { hours: [{ weeklyMinutes: 1560, validFrom: '2025-08-01', workdays: 0b0001111 }], leftOn: null }
    expect(youthLeaveOf(employee, 2026, '06-01', 2008)).toEqual({ perYear: 17, inYear: 17 })
    expect(youthLeaveOf(employee, 2027, '06-01', 2008)).toBeNull()
  })
})

describe('§§ 32, 33 JArbSchG: examinations', () => {
  const minor = { birthday: '06-01', birthYear: 2009 } // 18 on 1 June 2027
  it('wants the first examination by the start of employment', () => {
    const facts = { ...minor, start: '2026-08-01' as IsoDate }
    expect(youthExamStatus('youth_initial', facts, null, '2026-05-01')).toEqual({ state: 'ok', dueOn: '2026-08-01' })
    expect(youthExamStatus('youth_initial', facts, null, '2026-06-01')).toEqual({ state: 'soon', dueOn: '2026-08-01' })
    expect(youthExamStatus('youth_initial', facts, null, '2026-08-01')).toEqual({ state: 'overdue', dueOn: '2026-08-01' })
    expect(youthExamStatus('youth_initial', facts, '2026-07-10', '2026-08-01')).toEqual({ state: 'ok', dueOn: null })
  })
  it('wants the follow-up examination one year after the start, if still under 18 then', () => {
    const facts = { ...minor, start: '2025-09-01' as IsoDate }
    // „bald fällig“ from nine months after the start (§ 33 Abs. 1 Satz 2).
    expect(youthExamStatus('youth_followup', facts, null, '2026-05-31')).toEqual({ state: 'ok', dueOn: '2026-09-01' })
    expect(youthExamStatus('youth_followup', facts, null, '2026-06-01')).toEqual({ state: 'soon', dueOn: '2026-09-01' })
    expect(youthExamStatus('youth_followup', facts, null, '2026-07-15')).toEqual({ state: 'soon', dueOn: '2026-09-01' })
    expect(youthExamStatus('youth_followup', facts, null, '2026-09-01')).toEqual({ state: 'overdue', dueOn: '2026-09-01' })
    expect(youthExamStatus('youth_followup', facts, '2026-08-20', '2026-09-01')).toEqual({ state: 'ok', dueOn: null })
    // 18 before the year is over: no follow-up examination.
    expect(youthExamStatus('youth_followup', { ...facts, start: '2026-07-01' }, null, '2026-11-19')).toBeNull()
    expect(youthExamStatus('youth_initial', { ...facts, start: '2026-07-01' }, null, '2026-11-19')).toEqual({ state: 'overdue', dueOn: '2026-07-01' })
  })
  it('applies only to whoever is under 18 at the relevant day and still today, or has a record', () => {
    expect(youthExamStatus('youth_initial', { birthday: '06-01', birthYear: 2000, start: '2026-08-01' }, null, '2026-05-01')).toBeNull()
    expect(youthExamStatus('youth_initial', { birthday: null, birthYear: null, start: '2026-08-01' }, null, '2026-05-01')).toBeNull()
    // The birth year alone, certainly under 18.
    expect(youthExamStatus('youth_initial', { birthday: null, birthYear: 2010, start: '2026-08-01' }, null, '2026-05-01'))
      .toEqual({ state: 'ok', dueOn: '2026-08-01' })
    expect(youthExamStatus('youth_initial', { ...minor, start: null }, null, '2026-05-01')).toBeNull()
    // Started at 17, 18 by now and nothing recorded: nothing to do any more.
    expect(youthExamStatus('youth_initial', { ...minor, start: '2026-08-01' }, null, '2027-06-01')).toBeNull()
    expect(youthExamStatus('youth_initial', { ...minor, start: '2026-08-01' }, '2026-07-01', '2027-06-01')).toEqual({ state: 'ok', dueOn: null })
    expect(youthExamStatus('youth_initial', { birthday: '06-01', birthYear: 2000, start: '2026-08-01' }, '2026-07-01', '2026-11-19'))
      .toEqual({ state: 'ok', dueOn: null })
  })
  it('bans further employment 14 months after the start without the follow-up certificate (§ 33 Abs. 3)', () => {
    const facts = { ...minor, start: '2025-09-01' as IsoDate }
    expect(youthFollowupBanFrom('2025-09-01', false)).toBe('2026-11-01')
    expect(youthFollowupBanFrom('2025-09-01', true)).toBeNull()
    expect(youthFollowupBanFrom(null, false)).toBeNull()
    // 31 December + 14 months: the last day of February
    expect(youthFollowupBanFrom('2025-12-31', false)).toBe('2027-02-28')
    expect(youthFollowupBanOn(facts, false, '2026-10-31')).toBe(false)
    expect(youthFollowupBanOn(facts, false, '2026-11-01')).toBe(true)
    expect(youthFollowupBanOn(facts, true, '2026-11-01')).toBe(false)
    // ends with the 18th birthday (1 June 2027)
    expect(youthFollowupBanOn(facts, false, '2027-05-31')).toBe(true)
    expect(youthFollowupBanOn(facts, false, '2027-06-01')).toBe(false)
  })
  it('gives the plan hint on each day with work from the ban on (§ 33 Abs. 3)', () => {
    const work: Record<string, DomainEntry[]> = { '2026-11-02': [special(1, '2026-11-02', 480, 720)], '2026-10-30': [special(1, '2026-10-30', 480, 720)] }
    const warnings = youthWarnings({
      employeeId: 1, from: '2026-10-26', to: '2026-11-08', holidays: HOLIDAYS, entriesOf: date => work[date] ?? [],
      appliesOn: () => true, examBanFrom: '2026-11-01',
    })
    expect(warnings.filter(w => w.rule === 'examBan').map(w => [w.date, w.value, w.limit])).toEqual([['2026-11-02', 240, 0]])
  })
})

