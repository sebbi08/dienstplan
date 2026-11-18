import type { AgeLimitCountDto, AgeLimitRuleDto, AgeLimitWarningDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** In the Belegung's child list: „unter 3 Jahren: 6 von 5“ or „2–3 Jahre: 4 von 3“. */
export function ageLimitCountText(entry: AgeLimitCountDto): string {
  return de.ageLimits.count(de.ageLimits.range(entry.fromYears, entry.toYears), entry.count, entry.maxChildren)
}

/** „In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).“ */
export function ageLimitWarningText(warning: AgeLimitWarningDto): string {
  return de.ageLimits.warning(
    warning.groupName, `${de.months[warning.month - 1]} ${warning.year}`,
    de.ageLimits.rangeInText(warning.fromYears, warning.toYears), warning.count, warning.maxChildren,
  )
}

/** The rule as set: „von 0 bis unter 3 Jahren: höchstens 5 Kinder“. */
export const ageLimitRuleText = (rule: AgeLimitRuleDto): string => de.ageLimits.rule(rule.fromYears, rule.toYears, rule.maxChildren)
