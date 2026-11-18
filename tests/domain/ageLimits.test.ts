import { describe, expect, it } from 'vitest'
import {
  ageLimitRuleError, ageLimitViolations, ageOnFirstOfMonth, firstAgeLimitViolations, monthsFrom,
  type AgeLimitChild, type GroupAgeRule,
} from '../../shared/domain/ageLimits'
import type { GroupEntry } from '../../shared/domain/occupancy'

const child = (
  id: number, birthDate: string, start: string | null, end: string | null = null,
  groups: GroupEntry[] = [{ from: null, groupId: 1 }],
): AgeLimitChild => ({ id, birthDate, start, end, groups })
const rule = (id: number, fromYears: number, toYears: number, maxChildren: number, groupId = 1): GroupAgeRule =>
  ({ id, groupId, fromYears, toYears, maxChildren })

describe('ageOnFirstOfMonth', () => {
  it('is the age in completed years on the 1st of the month', () => {
    expect(ageOnFirstOfMonth('2024-03-15', 2027, 3)).toBe(2)
    expect(ageOnFirstOfMonth('2024-03-15', 2027, 4)).toBe(3)
    expect(ageOnFirstOfMonth('2024-03-15', 2024, 4)).toBe(0)
  })

  it('counts a birthday on the 1st in that month already', () => {
    expect(ageOnFirstOfMonth('2024-03-01', 2027, 3)).toBe(3)
    expect(ageOnFirstOfMonth('2024-03-01', 2027, 2)).toBe(2)
  })

  it('counts a birthday on the 2nd only from the next month on', () => {
    expect(ageOnFirstOfMonth('2024-03-02', 2027, 3)).toBe(2)
  })
})

describe('ageLimitRuleError', () => {
  it('accepts whole years 0 to 18 with from below to and a number of children from 0 on', () => {
    expect(ageLimitRuleError({ fromYears: 0, toYears: 3, maxChildren: 5 })).toBeNull()
    expect(ageLimitRuleError({ fromYears: 17, toYears: 18, maxChildren: 0 })).toBeNull()
  })

  it('rejects years outside 0 to 18 or not whole', () => {
    expect(ageLimitRuleError({ fromYears: -1, toYears: 3, maxChildren: 5 })).toBe('age_limit_years_invalid')
    expect(ageLimitRuleError({ fromYears: 0, toYears: 19, maxChildren: 5 })).toBe('age_limit_years_invalid')
    expect(ageLimitRuleError({ fromYears: 0.5, toYears: 3, maxChildren: 5 })).toBe('age_limit_years_invalid')
  })

  it('rejects from not below to', () => {
    expect(ageLimitRuleError({ fromYears: 3, toYears: 3, maxChildren: 5 })).toBe('age_limit_range_invalid')
    expect(ageLimitRuleError({ fromYears: 4, toYears: 3, maxChildren: 5 })).toBe('age_limit_range_invalid')
  })

  it('rejects a negative or broken number of children', () => {
    expect(ageLimitRuleError({ fromYears: 0, toYears: 3, maxChildren: -1 })).toBe('age_limit_max_invalid')
    expect(ageLimitRuleError({ fromYears: 0, toYears: 3, maxChildren: 1.5 })).toBe('age_limit_max_invalid')
    expect(ageLimitRuleError({ fromYears: 0, toYears: 3, maxChildren: 201 })).toBe('age_limit_max_invalid')
  })
})

describe('monthsFrom', () => {
  it('gives the month of the day and the following ones, over the turn of the year', () => {
    expect(monthsFrom('2026-11-18', 3)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }])
  })
})

describe('ageLimitViolations', () => {
  const months = monthsFrom('2026-11-01', 12)

  it('finds a rule exceeded now, with the children counted', () => {
    const children = [child(1, '2025-01-10', '2026-01-01'), child(2, '2025-02-10', '2026-01-01'), child(3, '2020-01-01', '2026-01-01')]
    const found = ageLimitViolations(children, [rule(7, 0, 3, 1)], [{ year: 2026, month: 11 }])
    expect(found).toEqual([{ groupId: 1, rule: rule(7, 0, 3, 1), year: 2026, month: 11, count: 2, childIds: [1, 2] }])
  })

  it('does not report a rule at its limit', () => {
    const children = [child(1, '2025-01-10', '2026-01-01'), child(2, '2025-02-10', '2026-01-01')]
    expect(ageLimitViolations(children, [rule(7, 0, 3, 2)], months)).toEqual([])
  })

  it('finds a rule exceeded only in the future, when a contract starts', () => {
    const children = [child(1, '2025-01-10', '2026-01-01'), child(2, '2025-02-10', '2027-03-15')]
    const found = ageLimitViolations(children, [rule(7, 0, 3, 1)], months)
    expect(found.map(entry => `${entry.year}-${entry.month}`)).toEqual(['2027-3', '2027-4', '2027-5', '2027-6', '2027-7', '2027-8', '2027-9', '2027-10'])
  })

  it('stops counting a child once it ages out of the range (on the 1st of its birthday month)', () => {
    // Child 1 turns 3 on 2027-02-01: from February on it no longer counts under 3.
    const children = [child(1, '2024-02-01', '2026-01-01'), child(2, '2025-02-10', '2026-01-01')]
    const found = ageLimitViolations(children, [rule(7, 0, 3, 1)], months)
    expect(found.map(entry => `${entry.year}-${entry.month}`)).toEqual(['2026-11', '2026-12', '2027-1'])
  })

  it('checks overlapping rules each on their own', () => {
    // Under 3: 3 children (max 5, fine); 2 to under 3: 2 children (max 1, over).
    const children = [child(1, '2024-06-10', '2026-01-01'), child(2, '2024-07-10', '2026-01-01'), child(3, '2025-08-10', '2026-01-01')]
    const found = ageLimitViolations(children, [rule(7, 0, 3, 5), rule(8, 2, 3, 1)], [{ year: 2026, month: 11 }])
    expect(found).toEqual([{ groupId: 1, rule: rule(8, 2, 3, 1), year: 2026, month: 11, count: 2, childIds: [1, 2] }])
  })

  it('counts only the children in the rule\'s group, with the occupancy\'s rules (group changes, leaving)', () => {
    const children = [
      child(1, '2025-01-10', '2026-01-01'),
      child(2, '2025-02-10', '2026-01-01', null, [{ from: null, groupId: 2 }]),
      child(3, '2025-03-10', '2026-01-01', '2026-10-31'),
      child(4, '2025-04-10', '2026-01-01', null, [{ from: null, groupId: 2 }, { from: '2027-01-15', groupId: 1 }]),
    ]
    const found = ageLimitViolations(children, [rule(7, 0, 3, 1)], [{ year: 2026, month: 11 }, { year: 2027, month: 1 }])
    expect(found).toEqual([{ groupId: 1, rule: rule(7, 0, 3, 1), year: 2027, month: 1, count: 2, childIds: [1, 4] }])
  })

  it('treats a maximum of 0 as no child of that age at all', () => {
    expect(ageLimitViolations([child(1, '2025-01-10', '2026-01-01')], [rule(7, 0, 1, 0)], [{ year: 2026, month: 11 }])).toEqual([])
    expect(ageLimitViolations([child(1, '2026-01-10', '2026-01-01')], [rule(7, 0, 1, 0)], [{ year: 2026, month: 11 }])).toHaveLength(1)
  })
})

describe('firstAgeLimitViolations', () => {
  it('keeps the first month per group and rule, in the order of the rules given', () => {
    const children = [
      child(1, '2025-01-10', '2026-01-01'), child(2, '2025-02-10', '2027-01-01'),
      child(3, '2025-03-10', '2026-01-01', null, [{ from: null, groupId: 2 }]),
      child(4, '2025-04-10', '2026-01-01', null, [{ from: null, groupId: 2 }]),
    ]
    const rules = [rule(7, 0, 3, 1), rule(9, 0, 3, 1, 2)]
    const found = firstAgeLimitViolations(ageLimitViolations(children, rules, monthsFrom('2026-11-01', 12)))
    expect(found.map(entry => [entry.groupId, entry.rule.id, entry.year, entry.month, entry.count])).toEqual([
      [1, 7, 2027, 1, 2],
      [2, 9, 2026, 11, 2],
    ])
  })
})
