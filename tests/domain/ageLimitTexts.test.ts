import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { ageLimitCountText, ageLimitListMessage, ageLimitRuleText, ageLimitWarningText } from '../../app/utils/ageLimits'
import { errorMessage } from '../../app/utils/errors'
import { ageLimitWarningLines } from '../../app/composables/useCapacityWarnings'

const warning = (fromYears: number, toYears: number, count = 6, maxChildren = 5) => ({
  groupId: 1, groupName: 'Bären', fromYears, toYears, maxChildren, count, year: 2027, month: 3,
})

describe('the texts of the age limits', () => {
  it('names a rule in the Belegung as „unter B Jahren“ from 0, else „von A bis unter B Jahren“', () => {
    expect(ageLimitCountText({ fromYears: 0, toYears: 3, maxChildren: 5, count: 6 })).toBe('unter 3 Jahren: 6 von 5')
    expect(ageLimitCountText({ fromYears: 2, toYears: 3, maxChildren: 3, count: 4 })).toBe('von 2 bis unter 3 Jahren: 4 von 3')
    expect(ageLimitCountText({ fromYears: 0, toYears: 1, maxChildren: 1, count: 2 })).toBe('unter 1 Jahr: 2 von 1')
  })

  it('words the hint with group, month and rule', () => {
    expect(ageLimitWarningText(warning(0, 3))).toBe('In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).')
    expect(ageLimitWarningText(warning(2, 3))).toBe('In Bären sind ab März 2027 zu viele Kinder von 2 bis unter 3 Jahren (6 von 5).')
    expect(ageLimitWarningText(warning(0, 1, 2, 1))).toBe('In Bären sind ab März 2027 zu viele Kinder unter 1 Jahr (2 von 1).')
  })

  it('puts „Achtung:“ before the same text after a save', () => {
    expect(ageLimitWarningLines([warning(0, 3)])).toEqual(['Achtung: In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).'])
  })

  it('shows the rule as set, with „1 Jahr“ and „1 Kind“ in the singular', () => {
    expect(ageLimitRuleText({ fromYears: 0, toYears: 3, maxChildren: 5 })).toBe('von 0 bis unter 3 Jahren: höchstens 5 Kinder')
    expect(ageLimitRuleText({ fromYears: 0, toYears: 1, maxChildren: 1 })).toBe('von 0 bis unter 1 Jahr: höchstens 1 Kind')
    expect(ageLimitRuleText({ fromYears: 2, toYears: 3, maxChildren: 0 })).toBe('von 2 bis unter 3 Jahren: höchstens 0 Kinder')
    expect([de.ageLimits.years('1'), de.ageLimits.years('3'), de.ageLimits.children('1'), de.ageLimits.children('')])
      .toEqual(['Jahr:', 'Jahren:', 'Kind', 'Kinder'])
  })

  it('names the row of a wrong rule before saving', () => {
    const ok = { fromYears: 0, toYears: 3, maxChildren: 5 }
    expect(ageLimitListMessage([ok])).toBeNull()
    expect(ageLimitListMessage([ok, { fromYears: 3, toYears: 2, maxChildren: 1 }])).toEqual({
      row: 2, text: `Regel 2: ${de.errors.age_limit_range_invalid}`,
    })
    expect(ageLimitListMessage([ok, ok])).toEqual({ row: 2, text: `Regel 2: ${de.errors.age_limit_duplicate}` })
    expect(ageLimitListMessage(Array.from({ length: 21 }, (_, max) => ({ ...ok, maxChildren: max }))))
      .toEqual({ row: null, text: de.errors.age_limits_too_many })
  })

  it('has a German text for every error of a rule', () => {
    const failed = (code: string) => ({ data: { data: { code } } })
    for (const code of ['age_limit_years_invalid', 'age_limit_range_invalid', 'age_limit_max_invalid', 'age_limits_too_many', 'age_limit_duplicate']) {
      expect(errorMessage(failed(code)), code).not.toBe(de.errors.generic)
    }
  })
})
