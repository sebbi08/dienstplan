import { describe, expect, it } from 'vitest'
import { effectiveEveYear, eveModeIn, eveRuleOf, halfOnEveDay, type EveRule } from '../../shared/domain/eveRules'
import { leaveDayWeight } from '../../shared/domain/leave'

const RULES: EveRule[] = [{ fromYear: 0, mode: 'half' }, { fromYear: 2026, mode: 'paid' }, { fromYear: 2028, mode: 'whole' }]

describe('rules for 24 and 31 December per year', () => {
  it('takes the entry with the latest from-year not after the year; none = whole leave day', () => {
    expect(eveModeIn(RULES, 2025)).toBe('half')
    expect(eveModeIn(RULES, 2026)).toBe('paid')
    expect(eveModeIn(RULES, 2027)).toBe('paid')
    expect(eveModeIn(RULES, 2028)).toBe('whole')
    expect(eveModeIn([], 2026)).toBe('whole')
    expect(eveModeIn(undefined, 2026)).toBe('whole')
    expect(eveRuleOf(RULES, 2027)).toEqual({ fromYear: 2026, mode: 'paid' })
  })

  it('applies a change from this year until 23 December, from 24 December on from the next year', () => {
    expect(effectiveEveYear('2026-11-20')).toBe(2026)
    expect(effectiveEveYear('2026-12-23')).toBe(2026)
    expect(effectiveEveYear('2026-12-24')).toBe(2027)
    expect(effectiveEveYear('2026-12-31')).toBe(2027)
    expect(effectiveEveYear('2027-01-01')).toBe(2027)
  })

  it('weighs half a leave day only on 24/31 December of a half year', () => {
    expect(halfOnEveDay('2025-12-24', RULES)).toBe(true)
    expect(halfOnEveDay('2025-12-23', RULES)).toBe(false)
    expect(halfOnEveDay('2028-12-31', RULES)).toBe(false)
    expect(leaveDayWeight('2025-12-31', RULES)).toBe(0.5)
    expect(leaveDayWeight('2028-12-31', RULES)).toBe(1)
    expect(leaveDayWeight('2028-12-31', true)).toBe(0.5)
  })
})
