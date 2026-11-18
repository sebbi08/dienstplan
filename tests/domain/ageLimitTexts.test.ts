import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { ageLimitCountText, ageLimitRuleText, ageLimitWarningText } from '../../app/utils/ageLimits'
import { errorMessage } from '../../app/utils/errors'
import { ageLimitWarningLines } from '../../app/composables/useCapacityWarnings'

const warning = (fromYears: number, toYears: number) => ({
  groupId: 1, groupName: 'Bären', fromYears, toYears, maxChildren: 5, count: 6, year: 2027, month: 3,
})

describe('the texts of the age limits', () => {
  it('names a rule in the Belegung as „unter B Jahren“ from 0, else „A–B Jahre“', () => {
    expect(ageLimitCountText({ fromYears: 0, toYears: 3, maxChildren: 5, count: 6 })).toBe('unter 3 Jahren: 6 von 5')
    expect(ageLimitCountText({ fromYears: 2, toYears: 3, maxChildren: 3, count: 4 })).toBe('2–3 Jahre: 4 von 3')
  })

  it('words the hint with group, month and rule', () => {
    expect(ageLimitWarningText(warning(0, 3))).toBe('In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).')
    expect(ageLimitWarningText(warning(2, 3))).toBe('In Bären sind ab März 2027 zu viele Kinder von 2 bis unter 3 Jahren (6 von 5).')
  })

  it('puts „Achtung:“ before the same text after a save', () => {
    expect(ageLimitWarningLines([warning(0, 3)])).toEqual(['Achtung: In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).'])
  })

  it('shows the rule as set', () => {
    expect(ageLimitRuleText({ fromYears: 0, toYears: 3, maxChildren: 5 })).toBe('von 0 bis unter 3 Jahren: höchstens 5 Kinder')
  })

  it('has a German text for every error of a rule', () => {
    const failed = (code: string) => ({ data: { data: { code } } })
    for (const code of ['age_limit_years_invalid', 'age_limit_range_invalid', 'age_limit_max_invalid', 'age_limits_too_many']) {
      expect(errorMessage(failed(code)), code).not.toBe(de.errors.generic)
    }
  })
})
