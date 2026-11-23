import { describe, expect, it } from 'vitest'
import {
  checkParentalLeave, coveredDays, cutEntitlement, firstWorkingDayAfter, fullParentalLeaveOn, lastParentalLeaveDay, leaveCutMonths,
  leaveProtectedUntil, leaveProtection, levelShiftDays, levelShiftHints, parentalLeaveEnd, parentalLeaveLength, protectedNoticeFrom,
  returnReminderState, type ParentalLeavePeriod,
} from '../../shared/domain/parentalLeave'
import { maternityMonthWarning } from '../../shared/domain/maternity'
import { dailyTarget, isWorkday, weeklyTargetMinutesOn, type EmploymentInfo } from '../../shared/domain/targets'
import { isWeekend } from '../../shared/domain/dates'
import { formatWeekdayDate, lengthText, parentalLeaveCells } from '../../app/utils/parentalLeave'

const period = (start: string, end: string, values: Partial<ParentalLeavePeriod> = {}): ParentalLeavePeriod => ({
  start, end, partTimeWeeklyMinutes: null, reduceLeave: false, ...values,
})

describe('end and duration', () => {
  it('ends n months after the start minus a day, at month ends on the last day of the shorter month (§ 188 BGB)', () => {
    expect(parentalLeaveEnd('2027-01-11', 12)).toBe('2028-01-10')
    expect(parentalLeaveEnd('2027-03-01', 1)).toBe('2027-03-31')
    expect(parentalLeaveEnd('2027-01-31', 1)).toBe('2027-02-28')
    expect(parentalLeaveEnd('2028-01-31', 1)).toBe('2028-02-29')
    expect(parentalLeaveEnd('2027-08-31', 2)).toBe('2027-10-30')
  })

  it('turns an end back into full months and the days beyond them', () => {
    expect(parentalLeaveLength('2027-01-11', '2028-01-10')).toEqual({ months: 12, days: 0 })
    expect(parentalLeaveLength('2027-01-31', '2027-02-28')).toEqual({ months: 1, days: 0 })
    expect(parentalLeaveLength('2027-03-01', '2027-04-10')).toEqual({ months: 1, days: 10 })
    expect(parentalLeaveLength('2027-03-01', '2027-03-14')).toEqual({ months: 0, days: 14 })
    expect(parentalLeaveLength('2027-03-01', '2027-02-14')).toEqual({ months: 0, days: 0 })
  })

  it('ends at the latest the day before the 8th birthday', () => {
    expect(lastParentalLeaveDay('2026-11-16')).toBe('2034-11-15')
    expect(lastParentalLeaveDay('2020-02-29')).toBe('2028-02-28')
  })
})

describe('the checks', () => {
  const birth = '2026-11-16'
  it('refuses an end before the start, a start before the birth, an end after the 8th birthday and overlaps', () => {
    expect(checkParentalLeave({ childBirthDate: birth, start: '2027-02-01', end: '2027-01-31' }, []).error).toBe('end_before_start')
    expect(checkParentalLeave({ childBirthDate: birth, start: '2026-11-15', end: '2027-01-31' }, []).error).toBe('before_birth')
    expect(checkParentalLeave({ childBirthDate: birth, start: '2034-01-01', end: '2034-11-16' }, []).error).toBe('after_eighth_birthday')
    expect(checkParentalLeave({ childBirthDate: birth, start: '2034-01-01', end: '2034-11-15' }, []).error).toBeNull()
    const other = { childBirthDate: '2024-05-05', start: '2027-01-01', end: '2027-03-31' }
    expect(checkParentalLeave({ childBirthDate: birth, start: '2027-03-31', end: '2027-06-30' }, [other]).error).toBe('overlap')
    expect(checkParentalLeave({ childBirthDate: birth, start: '2027-04-01', end: '2027-06-30' }, [other]).error).toBeNull()
  })

  it('hints at a fourth section and at more than 36 months per child, without refusing', () => {
    const sections = ['2027-01-01', '2028-01-01', '2029-01-01'].map(start => ({ childBirthDate: birth, start, end: `${start.slice(0, 4)}-03-31` }))
    const fourth = checkParentalLeave({ childBirthDate: birth, start: '2030-01-01', end: '2030-03-31' }, sections)
    expect(fourth).toMatchObject({ error: null, hints: ['sections'], sections: 4, totalMonths: 12 })
    expect(checkParentalLeave({ childBirthDate: birth, start: '2030-01-01', end: '2030-03-31' }, sections.slice(1)).hints).toEqual([])
    // Another child's sections do not count.
    expect(checkParentalLeave({ childBirthDate: birth, start: '2030-01-01', end: '2030-03-31' },
      sections.map(item => ({ ...item, childBirthDate: '2024-05-05' }))).hints).toEqual([])
    const long = checkParentalLeave({ childBirthDate: birth, start: '2027-01-17', end: '2029-12-16' }, [{ childBirthDate: birth, start: '2026-11-16', end: '2027-01-16' }])
    expect(long.hints).toEqual(['total'])
    expect(long.totalMonths).toBe(37)
    expect(checkParentalLeave({ childBirthDate: birth, start: '2026-11-16', end: '2029-11-15' }, []).hints).toEqual([])
  })
})

describe('the first working day after', () => {
  const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: { state: 'BW', assumptionDay: true } }
  it('skips the weekend, public holidays, closures and the days off of a part-time week', () => {
    // Friday 31.12.2027 → Monday 03.01.2028.
    expect(firstWorkingDayAfter('2027-12-31', date => isWorkday(info, date))).toBe('2028-01-03')
    // Tuesday 05.01.2027 → 06.01. Heilige Drei Könige (BW) → Thursday 07.01.
    expect(firstWorkingDayAfter('2027-01-05', date => isWorkday(info, date))).toBe('2027-01-07')
    const closure = (date: string) => date >= '2027-01-07' && date <= '2027-01-08'
    expect(firstWorkingDayAfter('2027-01-05', date => isWorkday(info, date) && !closure(date))).toBe('2027-01-11')
    // Working Tuesday and Thursday only.
    const partTime: EmploymentInfo = { ...info, hours: [{ weeklyMinutes: 900, validFrom: '2026-01-01', workdays: 0b0001010 }] }
    expect(firstWorkingDayAfter('2027-04-01', date => isWorkday(partTime, date))).toBe('2027-04-06')
    expect(firstWorkingDayAfter('2027-03-31', () => false)).toBeNull()
  })
})

describe('the days of an Elternzeit', () => {
  const base: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: { state: 'BW', assumptionDay: true } }
  it('are no working days and have no target in a full Elternzeit, the part-time hours with part time', () => {
    const info: EmploymentInfo = {
      ...base,
      parentalLeaves: [period('2027-03-01', '2027-03-31'), period('2027-04-01', '2027-06-30', { partTimeWeeklyMinutes: 1200 })],
    }
    expect(isWorkday(info, '2027-03-15')).toBe(false)
    expect(dailyTarget(info, '2027-03-15')).toBe(0)
    expect(fullParentalLeaveOn(info.parentalLeaves, '2027-03-15')).toBe(true)
    expect(isWorkday(info, '2027-04-15')).toBe(true)
    expect(dailyTarget(info, '2027-04-15')).toBe(240)
    expect(dailyTarget(info, '2027-07-01')).toBe(468)
    expect(dailyTarget(info, '2027-02-26')).toBe(468)
    expect(isWeekend('2027-04-17') && dailyTarget(info, '2027-04-17')).toBe(0)
  })
})

describe('the leave cut (§ 17 Abs. 1 BEEG)', () => {
  it('counts the full calendar months of a full Elternzeit with the declared cut', () => {
    expect(leaveCutMonths([period('2027-03-01', '2027-08-31', { reduceLeave: true })], 2027)).toBe(6)
    // 16.03.–15.09.: April to August.
    expect(leaveCutMonths([period('2027-03-16', '2027-09-15', { reduceLeave: true })], 2027)).toBe(5)
    // Not without the declaration, not with part time.
    expect(leaveCutMonths([period('2027-03-01', '2027-08-31')], 2027)).toBe(0)
    expect(leaveCutMonths([period('2027-03-01', '2027-08-31', { reduceLeave: true, partTimeWeeklyMinutes: 900 })], 2027)).toBe(0)
    // Adjoining sections count together; a period over the turn of the year counts in each year.
    expect(leaveCutMonths([period('2027-03-01', '2027-03-15', { reduceLeave: true }), period('2027-03-16', '2027-04-30', { reduceLeave: true })], 2027)).toBe(2)
    expect(leaveCutMonths([period('2027-11-01', '2028-02-29', { reduceLeave: true })], 2027)).toBe(2)
    expect(leaveCutMonths([period('2027-11-01', '2028-02-29', { reduceLeave: true })], 2028)).toBe(2)
    expect(leaveCutMonths(undefined, 2027)).toBe(0)
  })

  it('rounds what is left as the BUrlG rounds parts of a year (at least half a day up)', () => {
    expect(cutEntitlement(30, 6)).toEqual({ days: 15, cut: 15 })
    expect(cutEntitlement(30, 5)).toEqual({ days: 18, cut: 12 })
    expect(cutEntitlement(30, 1)).toEqual({ days: 28, cut: 2 })
    expect(cutEntitlement(26, 2)).toEqual({ days: 22, cut: 4 })
    expect(cutEntitlement(20, 1)).toEqual({ days: 18.33, cut: 1.67 })
    expect(cutEntitlement(30, 12)).toEqual({ days: 0, cut: 30 })
    expect(cutEntitlement(30, 0)).toEqual({ days: 30, cut: 0 })
  })
})

describe('the remaining leave before an Elternzeit (§ 17 Abs. 2 BEEG)', () => {
  it('stays until the end of the year after the return, when the Elternzeit reaches into the year and begins by its forfeiture day', () => {
    // Leave of 2026 (lapsing 31.03.2027); Elternzeit from 01.02.2027 to 31.01.2028 → 31.12.2029.
    expect(leaveProtectedUntil([period('2027-02-01', '2028-01-31')], 2026, '2027-03-31')).toBe('2029-12-31')
    expect(leaveProtection([period('2027-02-01', '2028-01-31')], 2026, '2027-03-31')).toEqual({ until: '2029-12-31', returnDay: '2028-02-01' })
    // Begins after the forfeiture day: the leave of 2026 lapses as usual.
    expect(leaveProtectedUntil([period('2027-04-01', '2028-01-31')], 2026, '2027-03-31')).toBeNull()
    // Ended before the leave year began (back on 01.01.2026): the leave of 2026 is earned after the return – no protection.
    expect(leaveProtectedUntil([period('2025-01-01', '2025-12-31')], 2026, '2027-03-31')).toBeNull()
    // Ends in the middle of the leave year (back 01.07.2026): protected until 31.12.2027.
    expect(leaveProtectedUntil([period('2025-07-01', '2026-06-30')], 2026, '2027-03-31')).toBe('2027-12-31')
    // Part time during the Elternzeit is protected as well (the law makes no exception).
    expect(leaveProtectedUntil([period('2027-02-01', '2028-01-31', { partTimeWeeklyMinutes: 900 })], 2026, '2027-03-31')).toBe('2029-12-31')
  })

  it('is noticed from 1 July of its last year (six months before; the return always lies before that)', () => {
    expect(protectedNoticeFrom({ until: '2029-12-31', returnDay: '2028-02-01' })).toBe('2029-07-01')
    expect(protectedNoticeFrom({ until: '2027-12-31', returnDay: '2026-09-01' })).toBe('2027-07-01')
  })
})

describe('the TVöD level step', () => {
  it('moves by the days of full Elternzeit within the level years, also those that the move reaches', () => {
    expect(levelShiftDays([], '2020-01-01', '2027-01-01')).toBe(0)
    // 90 days in the running step.
    expect(levelShiftDays([period('2026-01-01', '2026-03-31')], '2020-01-01', '2027-01-01')).toBe(90)
    // Before the level years start: nothing.
    expect(levelShiftDays([period('2019-01-01', '2019-03-31')], '2020-01-01', '2027-01-01')).toBe(0)
    // Part time counts as service.
    expect(levelShiftDays([period('2026-01-01', '2026-03-31', { partTimeWeeklyMinutes: 900 })], '2020-01-01', '2027-01-01')).toBe(0)
    // Running past the nominal day: every day of it moves the step (01.12.2026–31.01.2027 = 62 days).
    expect(levelShiftDays([period('2026-12-01', '2027-01-31')], '2020-01-01', '2027-01-01')).toBe(62)
    // A second section the move reaches counts too.
    expect(levelShiftDays([period('2026-12-01', '2026-12-31'), period('2027-01-15', '2027-01-20')], '2020-01-01', '2027-01-01')).toBe(37)
  })
})

describe('the hints on a moved level step (§ 17 Abs. 3 TVöD)', () => {
  it('names more than five years of Elternzeit in a row and a calendar year with less than a month', () => {
    // Two children back to back: 01.01.2020–31.12.2022 and 01.01.2023–01.01.2025 = five years and a day.
    expect(levelShiftHints([period('2020-01-01', '2022-12-31'), period('2023-01-01', '2025-01-01')], '2018-01-01', '2030-01-01'))
      .toEqual(['longBreak', 'shortBreak'])
    expect(levelShiftHints([period('2020-01-01', '2022-12-31'), period('2023-01-01', '2024-12-31')], '2018-01-01', '2030-01-01')).toEqual([])
    // Two weeks in 2026.
    expect(levelShiftHints([period('2026-03-01', '2026-03-14')], '2020-01-01', '2027-01-15')).toEqual(['shortBreak'])
    // Part time is no interruption.
    expect(levelShiftHints([period('2026-03-01', '2026-03-14', { partTimeWeeklyMinutes: 900 })], '2020-01-01', '2027-01-15')).toEqual([])
  })
})

describe('more checks per child (§ 15 Abs. 2 BEEG)', () => {
  const birth = '2026-11-16'
  it('tells twins apart by the child of the personnel file', () => {
    const twin = { childId: 1, childBirthDate: birth, start: '2026-11-16', end: '2029-11-15' }
    expect(checkParentalLeave({ childId: 2, childBirthDate: birth, start: '2029-11-16', end: '2030-01-31' }, [twin]))
      .toMatchObject({ sections: 1, hints: [] })
    expect(checkParentalLeave({ childId: 1, childBirthDate: birth, start: '2029-11-16', end: '2030-01-31' }, [twin]))
      .toMatchObject({ sections: 2, hints: ['total'] })
  })

  it('counts the Mutterschutz after the birth towards the 36 months and hints at more than 24 months after the 3rd birthday', () => {
    // 35 months of Elternzeit plus 8 weeks of Mutterschutz after the birth.
    const check = checkParentalLeave({ childBirthDate: birth, start: '2027-01-11', end: '2029-12-10' }, [], { from: birth, to: '2027-01-10' })
    expect(check.hints).toEqual(['total'])
    expect(checkParentalLeave({ childBirthDate: birth, start: '2027-01-11', end: '2029-12-10' }, []).hints).toEqual([])
    // From the 3rd birthday (16.11.2029) 25 months.
    const late = checkParentalLeave({ childBirthDate: birth, start: '2029-11-16', end: '2031-12-15' }, [])
    expect(late).toMatchObject({ hints: ['afterThird'], monthsAfterThird: 25 })
    expect(checkParentalLeave({ childBirthDate: birth, start: '2029-11-16', end: '2031-11-15' }, []).hints).toEqual([])
  })
})

describe('part time on fewer days', () => {
  const base: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: { state: 'BW', assumptionDay: true } }
  it('spreads its hours over its own working days, and only they are working days', () => {
    // 20 hours on Monday to Wednesday.
    const info: EmploymentInfo = { ...base, parentalLeaves: [period('2027-04-01', '2027-06-30', { partTimeWeeklyMinutes: 1200, partTimeWorkdays: 0b0000111 })] }
    expect(dailyTarget(info, '2027-04-12')).toBe(400)
    expect(isWorkday(info, '2027-04-15')).toBe(false)
    expect(dailyTarget(info, '2027-04-15')).toBe(0)
    expect(weeklyTargetMinutesOn(info, '2027-04-15')).toBe(1200)
    expect(weeklyTargetMinutesOn(info, '2027-07-01')).toBe(2340)
    expect(weeklyTargetMinutesOn({ ...base, parentalLeaves: [period('2027-04-01', '2027-06-30')] }, '2027-04-15')).toBe(0)
    // Thursday 01.04. is no working day of the part time: the first one after a section ending 31.03. is Monday 05.04. (Easter Monday 29.03.).
    expect(firstWorkingDayAfter('2027-03-31', date => isWorkday(info, date))).toBe('2027-04-05')
  })

  it('makes the MuSchG limit of the agreed working time follow the part-time hours', () => {
    const info: EmploymentInfo = { ...base, parentalLeaves: [period('2027-04-01', '2027-06-30', { partTimeWeeklyMinutes: 1200 })] }
    const dates = ['2027-04-12', '2027-04-13', '2027-04-14', '2027-04-15', '2027-04-16', '2027-04-17', '2027-04-18']
    // 30 hours planned in a week of 20 contract hours in the part time (39 hours under the contract).
    const entriesOf = (date: string) => (date <= '2027-04-16' ? [{ kind: 'special' as const, start: 480, end: 840, breakStart: null, breakEnd: null, codeKey: null, creditMode: 'timed' as const }] : [])
    const warning = maternityMonthWarning({ employeeId: 1, dates, info, entriesOf, phase: 'pregnancy' })
    expect(warning).not.toBeNull()
    expect(maternityMonthWarning({ employeeId: 1, dates, info: base, entriesOf, phase: 'pregnancy' })).toBeNull()
  })
})

describe('covered days and the reminder', () => {
  it('counts overlapping periods once', () => {
    expect(coveredDays([period('2027-01-01', '2027-01-10'), period('2027-01-05', '2027-01-20'), period('2027-01-07', '2027-01-08')], '2027-01-01', '2027-01-31')).toBe(20)
    expect(coveredDays([period('2027-01-01', '2027-01-10')], '2027-01-05', '2027-01-06')).toBe(2)
  })

  it('reminds from four weeks before the first working day through that day', () => {
    expect(returnReminderState('2027-04-05', '2027-03-07')).toBeNull()
    expect(returnReminderState('2027-04-05', '2027-03-08')).toBe('upcoming')
    expect(returnReminderState('2027-04-05', '2027-04-05')).toBe('today')
    expect(returnReminderState('2027-04-05', '2027-04-06')).toBeNull()
  })
})

describe('the texts of the section and the plan', () => {
  it('names the first working day with its weekday and month, the length, and the plan label', () => {
    expect(formatWeekdayDate('2028-01-12')).toBe('Mittwoch, 12. Januar 2028')
    expect(formatWeekdayDate('2027-04-05')).toBe('Montag, 05. April 2027')
    expect(lengthText('2027-01-12', '2028-01-11')).toBe('12 Monate')
    expect(lengthText('2027-03-01', '2027-04-01')).toBe('1 Monat und 1 Tag')
    expect(lengthText('2027-03-01', '2027-03-14')).toBe('14 Tage')
    expect([...parentalLeaveCells({ parentalLeave: { cells: ['1|2027-01-12'], label: 'parental_leave' } })]).toEqual([['1|2027-01-12', 'Elternzeit']])
    expect([...parentalLeaveCells({ parentalLeave: { cells: ['1|2027-01-12'], label: 'absent' } })]).toEqual([['1|2027-01-12', 'abwesend']])
  })
})
