import { describe, expect, it } from 'vitest'
import { BW_RULES } from '../../shared/domain/holidays'
import type { DayHours, OpeningHours } from '../../shared/domain/openingHours'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { DomainEntry } from '../../shared/domain/types'
import { dayWarnings, timeWarnings, type CoverageRule, type EmployeeDay, type Warning } from '../../shared/domain/warnings'
import { code, F1, F2, M, S, shift, special } from '../helpers/entries'

const date = '2026-10-06'
const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }
const rules: CoverageRule[] = [
  { id: 1, label: 'Spätdienst 8:45–17:00', start: 525, end: 1020, minCount: 2 },
  { id: 2, label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 1 },
  { id: 3, label: 'Frühdienst 2 ab 7:30', start: 450, end: null, minCount: 1 },
]

function team(...entryLists: DomainEntry[][]): EmployeeDay[] {
  return entryLists.map((entries, index) => ({ employeeId: index + 1, groupId: null, info, entries }))
}

const fullCoverage = () => [
  [shift(1, date, ...F1)], [shift(2, date, ...F2)], [shift(3, date, ...S)], [shift(4, date, ...S)],
]

describe('dayWarnings', () => {
  it('returns nothing for a fully covered day', () => {
    expect(dayWarnings(date, team(...fullCoverage()), rules, false, BW_RULES)).toEqual([])
  })
  it('reports a missing coverage shift with counts', () => {
    const lists = fullCoverage()
    lists[3] = [shift(4, date, 465, 960, 700, 730)]
    expect(dayWarnings(date, team(...lists), rules, false, BW_RULES)).toEqual([
      { type: 'coverage', date, ruleId: 1, label: 'Spätdienst 8:45–17:00', found: 1, required: 2 },
    ])
  })
  it('counts special shifts but not codes for coverage', () => {
    const lists = fullCoverage()
    lists[3] = [special(4, date, 525, 1020)]
    lists[0] = [code(1, date, 'prep_time', 'timed', 420, 540)]
    expect(dayWarnings(date, team(...lists), rules, false, BW_RULES)).toEqual([
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 0, required: 1 },
      { type: 'target_gap', date, employeeId: 1, missingMinutes: 348 },
    ])
  })
  it('reports employees without any entry, but not those who left', () => {
    const lists = [...fullCoverage(), []]
    const employees = team(...lists)
    employees.push({ employeeId: 9, groupId: null, info: { ...info, leftOn: '2026-09-30' }, entries: [] })
    expect(dayWarnings(date, employees, rules, false, BW_RULES)).toEqual([
      { type: 'missing_entry', date, employeeId: 5 },
    ])
  })
  it('does not report sick employees', () => {
    const lists = [...fullCoverage(), [code(5, date, 'sick', 'daily_target')]]
    expect(dayWarnings(date, team(...lists), rules, false, BW_RULES)).toEqual([])
  })
  it('reports the remaining time when VZ does not fill the day (5:48 h)', () => {
    const lists = [...fullCoverage(), [code(5, date, 'prep_time', 'timed', 450, 570)]]
    expect(dayWarnings(date, team(...lists), rules, false, BW_RULES)).toEqual([
      { type: 'target_gap', date, employeeId: 5, missingMinutes: 348 },
    ])
  })
  it('does not count the hours of Überstundenfrei as missing (VZ 7:00–8:00, 8:00–11:00, ÜF 11:00–15:00)', () => {
    const lists = [...fullCoverage(), [
      code(5, date, 'prep_time', 'timed', 420, 480), special(5, date, 480, 660), code(5, date, 'overtime_off', 'none', 660, 900),
    ]]
    expect(dayWarnings(date, team(...lists), rules, false, BW_RULES)).toEqual([])
  })
  it('ignores a remaining time below 15 minutes (VZ + F2 after it = 7:45 h of 7:48 h)', () => {
    const lists = [...fullCoverage(), [code(5, date, 'prep_time', 'timed', 450, 570), shift(5, date, 570, 945, 700, 730)]]
    expect(dayWarnings(date, team(...lists), rules, false, BW_RULES)).toEqual([])
  })
  it('counts a helper for coverage only, without missing entry or target gap', () => {
    const lists = fullCoverage()
    const employees = team(...lists.slice(1))
    employees.push({ employeeId: 7, groupId: null, info, entries: [shift(7, date, ...F1)], coverageOnly: true })
    employees.push({ employeeId: 8, groupId: null, info, entries: [], coverageOnly: true })
    employees.push({ employeeId: 9, groupId: null, info, entries: [code(9, date, 'prep_time', 'timed', 450, 570)], coverageOnly: true })
    expect(dayWarnings(date, employees, rules, false, BW_RULES)).toEqual([])
  })
  it('counts a day spent in another plan as filled', () => {
    const employees = team(...fullCoverage())
    employees.push({ employeeId: 5, groupId: null, info, entries: [], busyElsewhere: true })
    expect(dayWarnings(date, employees, rules, false, BW_RULES)).toEqual([])
  })
  it('skips weekends, holidays and closure days', () => {
    expect(dayWarnings('2026-10-10', team([]), rules, false, BW_RULES)).toEqual([])
    expect(dayWarnings('2026-12-25', team([]), rules, false, BW_RULES)).toEqual([])
    expect(dayWarnings(date, team([]), rules, true, BW_RULES)).toEqual([])
  })
})

describe('dayWarnings with groups (Review Focus 2)', () => {
  const kaefer = 10
  const maeuse = 11
  const early: CoverageRule = { id: 1, label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 2 }
  const earlyKaefer: CoverageRule = { ...early, id: 2, minCount: 1, groupId: kaefer, groupName: 'Käfer' }
  const earlyMaeuse: CoverageRule = { ...early, id: 3, minCount: 2, groupId: maeuse, groupName: 'Mäuse' }
  const member = (employeeId: number, groupId: number | null, entries: DomainEntry[]): EmployeeDay =>
    ({ employeeId, groupId, info, entries })
  const coverage = (employees: EmployeeDay[], list: CoverageRule[]) =>
    dayWarnings(date, employees, list, false, BW_RULES).filter(warning => warning.type === 'coverage')

  it('counts each rule on a mixed day: a facility rule all duties, a group rule only its effective group', () => {
    const employees = [
      member(1, kaefer, [shift(1, date, ...F1)]),
      // A Käfer member whose duty counts for Mäuse today.
      member(2, kaefer, [shift(2, date, ...F1, { groupId: maeuse })]),
      // A Springer without an assigned group: facility rules only.
      member(3, null, [shift(3, date, ...F1)]),
      // A Mäuse member on another shift.
      member(4, maeuse, [shift(4, date, ...S)]),
    ]
    // Facility: 3 of 2; Käfer: 1 of 1 (member 1); Mäuse: 1 of 2 (member 2's moved duty).
    expect(coverage(employees, [early, earlyKaefer, earlyMaeuse])).toEqual([
      { type: 'coverage', date, ruleId: 3, label: 'Frühdienst ab 7:00', found: 1, required: 2, groupName: 'Mäuse' },
    ])
    employees[1] = member(2, kaefer, [shift(2, date, ...F1)])
    expect(coverage(employees, [{ ...early, minCount: 4 }, { ...earlyKaefer, minCount: 3 }, earlyMaeuse])).toEqual([
      { type: 'coverage', date, ruleId: 1, label: 'Frühdienst ab 7:00', found: 3, required: 4 },
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 2, required: 3, groupName: 'Käfer' },
      { type: 'coverage', date, ruleId: 3, label: 'Frühdienst ab 7:00', found: 0, required: 2, groupName: 'Mäuse' },
    ])
  })

  it('counts a Springer duty for a group only when it is assigned to it', () => {
    const springer = (groupId: number | null) => [member(3, null, [shift(3, date, ...F1, { groupId })])]
    expect(coverage(springer(null), [early, earlyKaefer])).toEqual([
      { type: 'coverage', date, ruleId: 1, label: 'Frühdienst ab 7:00', found: 1, required: 2 },
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 0, required: 1, groupName: 'Käfer' },
    ])
    expect(coverage(springer(kaefer), [earlyKaefer])).toEqual([])
  })

  it('counts a member\'s duty assigned to another group for that group, not the home group', () => {
    const employees = [member(1, kaefer, [shift(1, date, ...F1, { groupId: maeuse })])]
    expect(coverage(employees, [earlyKaefer])).toEqual([
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 0, required: 1, groupName: 'Käfer' },
    ])
    expect(coverage(employees, [{ ...earlyMaeuse, minCount: 1 }])).toEqual([])
  })

  it('counts a helper duty for a group only with an entry group, and always for facility rules', () => {
    const helper = (groupId: number | null): EmployeeDay =>
      ({ employeeId: 7, groupId: null, info, entries: [shift(7, date, ...F1, { groupId })], coverageOnly: true })
    const facilityOnce = { ...early, minCount: 1 }
    expect(coverage([helper(null)], [facilityOnce, earlyKaefer])).toEqual([
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 0, required: 1, groupName: 'Käfer' },
    ])
    expect(coverage([helper(kaefer)], [facilityOnce, earlyKaefer])).toEqual([])
  })

  it('leaves facilities without groups unchanged: no groupName key, every duty counts', () => {
    const employees = team([shift(1, date, ...F1)], [shift(2, date, ...F1, { groupId: null })])
    expect(coverage(employees, [{ ...early, groupId: null }])).toEqual([])
    const [warning] = coverage(employees, [{ ...early, minCount: 3 }])
    expect(warning).toStrictEqual({ type: 'coverage', date, ruleId: 1, label: 'Frühdienst ab 7:00', found: 2, required: 3 })
  })
})

describe('timeWarnings', () => {
  const date = '2026-10-06'
  const records = (...spans: [number, number | null][]) => spans.map(([start, end]) => ({ start, end }))
  it('reports open records, missing records, break rule and records without plan', () => {
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], records([465, null])).map(w => w.type)).toEqual(['open_record'])
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], []).map(w => w.type)).toEqual(['missing_record'])
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], records([465, 960])).map(w => w.type)).toEqual(['break_rule'])
    expect(timeWarnings(date, 1, [], records([465, 700])).map(w => w.type)).toEqual(['record_without_plan'])
  })
  it('stays quiet for absences from the plan and for correct days', () => {
    expect(timeWarnings(date, 1, [code(1, date, 'sick', 'daily_target')], [])).toEqual([])
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], records([465, 700], [730, 960]))).toEqual([])
    expect(timeWarnings(date, 1, [], [])).toEqual([])
  })
})

describe('working days in warnings', () => {
  it('does not ask for an entry on a part-timer’s day off', () => {
    const monToWed: EmploymentInfo = { hours: [{ weeklyMinutes: 1200, validFrom: '2026-01-01', workdays: 0b00111 }], leftOn: null, holidays: BW_RULES }
    const employees: EmployeeDay[] = [{ employeeId: 7, groupId: null, info: monToWed, entries: [] }]
    const missing = (day: string) => dayWarnings(day, employees, [], false, BW_RULES).filter(w => w.type === 'missing_entry')
    expect(missing('2026-10-07')).toHaveLength(1) // Wednesday: working day
    expect(missing('2026-10-08')).toEqual([]) // Thursday: day off
  })
})

describe('dayWarnings with weekdays and opening hours', () => {
  // 2026-10-05 Mo, 2026-10-06 Tu (`date`), 2026-10-09 Fr
  const monday = '2026-10-05'
  const friday = '2026-10-09'
  const none = { facility: null, groups: [] }
  const open = (from: number, to: number): DayHours => ({ open: from, close: to, closed: false })
  const emptyDay: DayHours = { open: null, close: null, closed: false }
  const closedDay: DayHours = { open: null, close: null, closed: true }
  const week = (days: DayHours[], minAtOpening = 1, minAtClosing = 1): OpeningHours => ({ days, minAtOpening, minAtClosing })
  const allDays = (value: DayHours) => [value, value, value, value, value]
  const edges = (list: Warning[]) => list.filter(warning => warning.type === 'edge')
  const coverageOf = (list: Warning[]) => list.filter(warning => warning.type === 'coverage')
  const person = (employeeId: number, groupId: number | null, entries: DomainEntry[], extra: Partial<EmployeeDay> = {}): EmployeeDay =>
    ({ employeeId, groupId, info, entries, ...extra })

  describe('rule weekdays', () => {
    const monThu: CoverageRule = { id: 7, label: 'Frühdienst', start: 420, end: null, minCount: 1, weekdays: 1 | 2 | 4 | 8 }
    it('checks a rule on its weekdays only', () => {
      expect(coverageOf(dayWarnings(monday, [], [monThu], false, BW_RULES, none))).toHaveLength(1)
      expect(coverageOf(dayWarnings(friday, [], [monThu], false, BW_RULES, none))).toEqual([])
    })
    it('treats a missing mask as all weekdays', () => {
      const rule: CoverageRule = { id: 8, label: 'Früh', start: 420, end: null, minCount: 1 }
      expect(coverageOf(dayWarnings(friday, [], [rule], false, BW_RULES, none))).toHaveLength(1)
    })
  })

  describe('closed weekdays', () => {
    const facilityRule: CoverageRule = { id: 1, label: 'Früh', start: 420, end: null, minCount: 1, weekdays: 31 }
    const groupRule: CoverageRule = { ...facilityRule, id: 2, groupId: 5, groupName: 'Mäuse' }
    const closedMonday = week([closedDay, open(420, 960), open(420, 960), open(420, 960), open(420, 960)])
    it('suppresses facility rules on a closed facility weekday but keeps missing entries', () => {
      const result = dayWarnings(monday, [person(1, null, [])], [facilityRule], false, BW_RULES, { facility: closedMonday, groups: [] })
      expect(result).toEqual([{ type: 'missing_entry', date: monday, employeeId: 1 }])
    })
    it('still checks rules on a weekday without entered hours', () => {
      const result = dayWarnings(monday, [], [facilityRule], false, BW_RULES, { facility: week(allDays(emptyDay)), groups: [] })
      expect(coverageOf(result)).toHaveLength(1)
    })
    it('uses the group hours for a group rule when the group has its own', () => {
      const hours = { facility: week(allDays(open(420, 960))), groups: [{ groupId: 5, groupName: 'Mäuse', hours: closedMonday }] }
      expect(coverageOf(dayWarnings(monday, [], [groupRule], false, BW_RULES, hours))).toEqual([])
    })
    it('uses the facility hours for a group rule when the group has none', () => {
      expect(coverageOf(dayWarnings(monday, [], [groupRule], false, BW_RULES, { facility: closedMonday, groups: [] }))).toEqual([])
    })
    it('checks a group rule on a facility-closed day when the group has own open hours', () => {
      const hours = { facility: closedMonday, groups: [{ groupId: 5, groupName: 'Mäuse', hours: week(allDays(open(420, 960))) }] }
      expect(coverageOf(dayWarnings(monday, [], [groupRule], false, BW_RULES, hours))).toHaveLength(1)
    })
    it('falls back to the facility closed day when the group left that weekday empty', () => {
      const groupHours = week([emptyDay, open(420, 960), open(420, 960), open(420, 960), open(420, 960)])
      const hours = { facility: closedMonday, groups: [{ groupId: 5, groupName: 'Mäuse', hours: groupHours }] }
      expect(coverageOf(dayWarnings(monday, [], [groupRule], false, BW_RULES, hours))).toEqual([])
      expect(edges(dayWarnings(monday, [], [], false, BW_RULES, hours))).toEqual([])
      // the group's set weekdays still apply
      expect(coverageOf(dayWarnings(friday, [], [groupRule], false, BW_RULES, hours))).toHaveLength(1)
    })
    it('uses the group closed day even when the facility is open that weekday', () => {
      const groupHours = week([closedDay, emptyDay, emptyDay, emptyDay, emptyDay])
      const hours = { facility: week(allDays(open(420, 960))), groups: [{ groupId: 5, groupName: 'Mäuse', hours: groupHours }] }
      expect(coverageOf(dayWarnings(monday, [], [groupRule], false, BW_RULES, hours))).toEqual([])
    })
  })

  describe('facility edges', () => {
    const hours = week(allDays(open(420, 990)))
    const run = (employees: EmployeeDay[], facility: OpeningHours = hours) =>
      edges(dayWarnings(date, employees, [], false, BW_RULES, { facility, groups: [] }))
    const earlyDuty = person(1, null, [shift(1, date, 420, 720)])
    const lateDuty = person(2, null, [shift(2, date, 600, 990)])
    const openingWarning = { type: 'edge', date, edge: 'opening', time: 420, found: 0, required: 1 }
    const closingWarning = { type: 'edge', date, edge: 'closing', time: 990, found: 0, required: 1 }

    it('is silent when opening and closing are covered', () => {
      expect(run([earlyDuty, lateDuty])).toEqual([])
    })
    it('does not count a duty starting after opening', () => {
      expect(run([person(1, null, [shift(1, date, 435, 990)])])).toEqual([openingWarning])
    })
    it('does not count a duty ending at opening or before', () => {
      expect(run([person(1, null, [shift(1, date, 360, 420)]), lateDuty])).toEqual([openingWarning])
    })
    it('counts a duty ending exactly at closing but not one ending before', () => {
      expect(run([earlyDuty, person(2, null, [shift(2, date, 600, 960)])])).toEqual([closingWarning])
    })
    it('does not count a duty starting at closing', () => {
      expect(run([earlyDuty, person(2, null, [shift(2, date, 990, 1020)])])).toEqual([closingWarning])
    })
    it('reports found and required for a minimum of two', () => {
      expect(run([earlyDuty, lateDuty], week(allDays(open(420, 990)), 2, 1))).toEqual([{ ...openingWarning, found: 1, required: 2 }])
      expect(run([earlyDuty, lateDuty], week(allDays(open(420, 990)), 1, 2))).toEqual([{ ...closingWarning, found: 1, required: 2 }])
    })
    it('counts special shifts and helpers', () => {
      const helper = person(3, null, [shift(3, date, 420, 800)], { coverageOnly: true })
      expect(run([helper, person(2, null, [special(2, date, 600, 990)])])).toEqual([])
    })
    it('never counts codes (break, sick, preparation time)', () => {
      expect(run([person(1, null, [code(1, date, 'prep_time', 'timed', 420, 990)])])).toEqual([openingWarning, closingWarning])
    })
    it('counts a shift with a break inside', () => {
      expect(run([person(1, null, [shift(1, date, 420, 990, 700, 730)])])).toEqual([])
    })
    it('does not count a shift that does not count as staff', () => {
      const kitchen = (start: number, end: number) => shift(1, date, start, end, null, null, { countsAsStaff: false })
      expect(run([person(1, null, [kitchen(420, 990)])])).toEqual([openingWarning, closingWarning])
      expect(run([person(1, null, [kitchen(420, 720)]), person(2, null, [shift(2, date, 600, 990)])])).toEqual([openingWarning])
      expect(run([earlyDuty, person(2, null, [kitchen(600, 990)])])).toEqual([closingWarning])
    })
    it('warns on an entered day without any duty', () => {
      expect(run([])).toEqual([openingWarning, closingWarning])
    })
    it('is silent on a weekend, a holiday, a closure day, a closed or a not entered weekday', () => {
      const give = (when: string, closure: boolean, facility: OpeningHours) =>
        edges(dayWarnings(when, [person(1, null, [])], [], closure, BW_RULES, { facility, groups: [] }))
      expect(give('2026-10-10', false, hours)).toEqual([])
      expect(give('2026-12-25', false, hours)).toEqual([])
      expect(give(date, true, hours)).toEqual([])
      expect(give(date, false, week(allDays(closedDay)))).toEqual([])
      expect(give(date, false, week(allDays(emptyDay)))).toEqual([])
      expect(give(date, false, week(allDays({ open: 420, close: null, closed: false })))).toEqual([])
    })
  })

  describe('group edges', () => {
    const groupHours = week(allDays(open(450, 960)))
    const hours = { facility: null, groups: [{ groupId: 5, groupName: 'Mäuse', hours: groupHours }] }
    const mouseOpening = { type: 'edge', date, edge: 'opening', time: 450, found: 0, required: 1, groupName: 'Mäuse', groupId: 5 }
    const mouseClosing = { type: 'edge', date, edge: 'closing', time: 960, found: 0, required: 1, groupName: 'Mäuse', groupId: 5 }
    it('counts duties of the home group', () => {
      expect(edges(dayWarnings(date, [person(1, 5, [shift(1, date, 450, 960)])], [], false, BW_RULES, hours))).toEqual([])
    })
    it('counts an entry group over the home group', () => {
      const moved = person(1, 5, [shift(1, date, 450, 960, null, null, { groupId: 6 })])
      expect(edges(dayWarnings(date, [moved], [], false, BW_RULES, hours))).toEqual([mouseOpening, mouseClosing])
      const borrowed = person(2, 6, [shift(2, date, 450, 960, null, null, { groupId: 5 })])
      expect(edges(dayWarnings(date, [borrowed], [], false, BW_RULES, hours))).toEqual([])
    })
    it('does not count helpers without an entry group', () => {
      const helper = person(3, null, [shift(3, date, 450, 960)], { coverageOnly: true })
      expect(edges(dayWarnings(date, [helper], [], false, BW_RULES, hours))).toEqual([mouseOpening, mouseClosing])
    })
    it('is checked on its own hours independently of the facility', () => {
      const both = { facility: week(allDays(open(420, 990))), groups: hours.groups }
      const result = edges(dayWarnings(date, [person(1, 5, [shift(1, date, 450, 960)])], [], false, BW_RULES, both))
      expect(result).toEqual([
        { type: 'edge', date, edge: 'opening', time: 420, found: 0, required: 1 },
        { type: 'edge', date, edge: 'closing', time: 990, found: 0, required: 1 },
      ])
    })
    it('uses the group minimum and is silent on a not entered weekday', () => {
      const two = { facility: null, groups: [{ groupId: 5, groupName: 'Mäuse', hours: week(allDays(open(450, 960)), 2, 1) }] }
      const staff = [person(1, 5, [shift(1, date, 450, 960)])]
      expect(edges(dayWarnings(date, staff, [], false, BW_RULES, two))).toEqual([{ ...mouseOpening, found: 1, required: 2 }])
      const blank = { facility: null, groups: [{ groupId: 5, groupName: 'Mäuse', hours: week(allDays(emptyDay)) }] }
      expect(edges(dayWarnings(date, [], [], false, BW_RULES, blank))).toEqual([])
    })
  })
})
