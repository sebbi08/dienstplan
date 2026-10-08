import { describe, expect, it } from 'vitest'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { DomainEntry } from '../../shared/domain/types'
import { dayWarnings, timeWarnings, type CoverageRule, type EmployeeDay } from '../../shared/domain/warnings'
import { code, F1, F2, M, S, shift, special } from '../helpers/entries'

const date = '2026-10-06'
const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }
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
    expect(dayWarnings(date, team(...fullCoverage()), rules, false)).toEqual([])
  })
  it('reports a missing coverage shift with counts', () => {
    const lists = fullCoverage()
    lists[3] = [shift(4, date, 465, 960, 700, 730)]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([
      { type: 'coverage', date, ruleId: 1, label: 'Spätdienst 8:45–17:00', found: 1, required: 2 },
    ])
  })
  it('counts special shifts but not codes for coverage', () => {
    const lists = fullCoverage()
    lists[3] = [special(4, date, 525, 1020)]
    lists[0] = [code(1, date, 'prep_time', 'timed', 420, 540)]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 0, required: 1 },
      { type: 'target_gap', date, employeeId: 1, missingMinutes: 348 },
    ])
  })
  it('reports employees without any entry, but not those who left', () => {
    const lists = [...fullCoverage(), []]
    const employees = team(...lists)
    employees.push({ employeeId: 9, groupId: null, info: { ...info, leftOn: '2026-09-30' }, entries: [] })
    expect(dayWarnings(date, employees, rules, false)).toEqual([
      { type: 'missing_entry', date, employeeId: 5 },
    ])
  })
  it('does not report sick employees', () => {
    const lists = [...fullCoverage(), [code(5, date, 'sick', 'daily_target')]]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([])
  })
  it('reports the remaining time when VZ does not fill the day (5:48 h)', () => {
    const lists = [...fullCoverage(), [code(5, date, 'prep_time', 'timed', 450, 570)]]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([
      { type: 'target_gap', date, employeeId: 5, missingMinutes: 348 },
    ])
  })
  it('ignores a remaining time below 15 minutes (VZ + F2 after it = 7:45 h of 7:48 h)', () => {
    const lists = [...fullCoverage(), [code(5, date, 'prep_time', 'timed', 450, 570), shift(5, date, 570, 945, 700, 730)]]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([])
  })
  it('counts a helper for coverage only, without missing entry or target gap', () => {
    const lists = fullCoverage()
    const employees = team(...lists.slice(1))
    employees.push({ employeeId: 7, groupId: null, info, entries: [shift(7, date, ...F1)], coverageOnly: true })
    employees.push({ employeeId: 8, groupId: null, info, entries: [], coverageOnly: true })
    employees.push({ employeeId: 9, groupId: null, info, entries: [code(9, date, 'prep_time', 'timed', 450, 570)], coverageOnly: true })
    expect(dayWarnings(date, employees, rules, false)).toEqual([])
  })
  it('counts a day spent in another plan as filled', () => {
    const employees = team(...fullCoverage())
    employees.push({ employeeId: 5, groupId: null, info, entries: [], busyElsewhere: true })
    expect(dayWarnings(date, employees, rules, false)).toEqual([])
  })
  it('skips weekends, holidays and closure days', () => {
    expect(dayWarnings('2026-10-10', team([]), rules, false)).toEqual([])
    expect(dayWarnings('2026-12-25', team([]), rules, false)).toEqual([])
    expect(dayWarnings(date, team([]), rules, true)).toEqual([])
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
    dayWarnings(date, employees, list, false).filter(warning => warning.type === 'coverage')

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
    const monToWed: EmploymentInfo = { hours: [{ weeklyMinutes: 1200, validFrom: '2026-01-01', workdays: 0b00111 }], leftOn: null }
    const employees: EmployeeDay[] = [{ employeeId: 7, groupId: null, info: monToWed, entries: [] }]
    const missing = (day: string) => dayWarnings(day, employees, [], false).filter(w => w.type === 'missing_entry')
    expect(missing('2026-10-07')).toHaveLength(1) // Wednesday: working day
    expect(missing('2026-10-08')).toEqual([]) // Thursday: day off
  })
})
