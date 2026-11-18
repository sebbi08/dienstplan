import { ageLimitListError, type AgeLimitRule } from '#shared/domain/ageLimits'
import type { AgeLimitCountDto, AgeLimitRuleDto, AgeLimitWarningDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorTextOf } from '~/utils/errors'

/** In the Belegung's child list: „unter 3 Jahren: 6 von 5“ or „von 2 bis unter 3 Jahren: 4 von 3“. */
export function ageLimitCountText(entry: AgeLimitCountDto): string {
  return de.ageLimits.count(de.ageLimits.range(entry.fromYears, entry.toYears), entry.count, entry.maxChildren)
}

/** „In Bären sind ab März 2027 zu viele Kinder unter 3 Jahren (6 von 5).“ */
export function ageLimitWarningText(warning: AgeLimitWarningDto): string {
  return de.ageLimits.warning(
    warning.groupName, `${de.months[warning.month - 1]} ${warning.year}`,
    de.ageLimits.range(warning.fromYears, warning.toYears), warning.count, warning.maxChildren,
  )
}

/** The rule as set: „von 0 bis unter 3 Jahren: höchstens 5 Kinder“. */
export const ageLimitRuleText = (rule: AgeLimitRuleDto): string => de.ageLimits.rule(rule.fromYears, rule.toYears, rule.maxChildren)

/**
 * The first error of the list the server would answer, as text with the rule's row („Regel 2: …“), and that row
 * (null for too many rules); null when the list is fine.
 */
export function ageLimitListMessage(rules: AgeLimitRule[]): { row: number | null; text: string } | null {
  const error = ageLimitListError(rules)
  if (!error) return null
  const text = errorTextOf(error.code)
  return { row: error.row, text: error.row === null ? text : de.ageLimits.rowError(error.row, text) }
}
