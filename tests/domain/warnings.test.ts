import { describe, expect, it } from 'vitest'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { DomainEntry } from '../../shared/domain/types'
import { dayWarnings, type CoverageRule, type EmployeeDay } from '../../shared/domain/warnings'
import { code, F1, F2, S, shift, special } from '../helpers/entries'

const date = '2026-10-06'
const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }
const rules: CoverageRule[] = [
  { id: 1, label: 'Spätdienst 8:45–17:00', start: 525, end: 1020, minCount: 2 },
  { id: 2, label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 1 },
  { id: 3, label: 'Frühdienst 2 ab 7:30', start: 450, end: null, minCount: 1 },
]

function team(...entryLists: DomainEntry[][]): EmployeeDay[] {
  return entryLists.map((entries, index) => ({ employeeId: index + 1, info, entries }))
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
    employees.push({ employeeId: 9, info: { ...info, leftOn: '2026-09-30' }, entries: [] })
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
  it('skips weekends, holidays and closure days', () => {
    expect(dayWarnings('2026-10-10', team([]), rules, false)).toEqual([])
    expect(dayWarnings('2026-12-25', team([]), rules, false)).toEqual([])
    expect(dayWarnings(date, team([]), rules, true)).toEqual([])
  })
})
