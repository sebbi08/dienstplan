// The label texts are imported relative (like settingsAreas.ts); the shared domain through the alias, which the build needs.
import { weekday } from '#shared/domain/dates'
import type { IfsgAnchor } from '#shared/domain/ifsg'
import type { IfsgDifference } from '#shared/domain/ifsgLocal'
import type { IsoDate } from '#shared/domain/types'
import { de } from '../locales/de'
import { formatDayMonth } from './format'

/** A day as „Mi 25.11.“ (the earliest readmission). */
export function ifsgDayText(day: IsoDate): string {
  return `${de.weekdaysShort[weekday(day)]} ${formatDayMonth(day)}`
}

/** „frühestens ab Mi 25.11.“ with the rule's condition („… und symptomfrei“), or the text that no day can be computed. */
export function ifsgEarliestText(earliest: IsoDate | null, condition = ''): string {
  if (earliest === null) return de.ifsg.noEarliest
  return [de.ifsg.earliest(ifsgDayText(earliest)), condition].filter(Boolean).join(' ')
}

/** The date rules as „Beginn des Ausschlags + 5 Tage“, joined; „kein Datum“ without any. */
export function ifsgRulesText(rules: readonly { anchor: IfsgAnchor; days: number }[]): string {
  if (rules.length === 0) return de.ifsg.local.noRule
  return rules.map(rule => de.ifsg.local.rule(de.ifsg.anchors[rule.anchor], rule.days)).join(' / ')
}

/** What a local rule changes against the RKI, as short texts for the marker „abweichend vom RKI“. */
export function ifsgDifferenceTexts(difference: IfsgDifference | null): string[] {
  if (difference === null) return []
  const d = de.ifsg.local.diff
  return [
    difference.proof ? d.proof(de.ifsg.proofs[difference.proof.rki], de.ifsg.proofs[difference.proof.local]) : '',
    difference.days ? d.days(ifsgRulesText(difference.days.rki), ifsgRulesText(difference.days.local)) : '',
    difference.notify ? d.notify(difference.notify.local) : '',
    difference.household ? d.household(difference.household.local) : '',
    difference.text && !difference.proof && !difference.days ? d.text : '',
  ].filter(Boolean)
}
