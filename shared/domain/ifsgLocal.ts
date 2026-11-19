import { addDays } from './dates'
import {
  IFSG_ANCHORS, IFSG_PROOFS, type IfsgAnchor, type IfsgDateRule, type IfsgDisease, type IfsgKindRule, type IfsgProof,
} from './ifsg'
import type { IsoDate } from './types'

// Local rules of the health office (Gesundheitsamt) for the readmission: they take precedence over the RKI catalogue
// field by field (`mergeIfsgRules`), and add local diseases (COVID-19, RSV, non-notifiable ones such as
// Hand-Fuß-Mund). The server stores them per facility and reads the merged rules through `ifsgRulesFor`.

/** A local date rule: readmission at the earliest `days` after the anchor day; `label` names the variant. */
export interface IfsgLocalDateRule {
  anchor: IfsgAnchor
  days: number
  label: string
}

/**
 * The local rule of a disease; every field is optional (null = the RKI value counts). `custom`: a local disease the RKI
 * catalogue does not have (then `name` is set and `notifiable` says whether § 34 forbids the visit: false = only a
 * recommendation, no block at „Kommt“, no reminder to notify). `rules` replaces the RKI date rules of the sick (null =
 * the RKI ones; an empty list = no date). `notify`: the facility must notify the health office. `householdExclusion`:
 * healthy household members are excluded too (Abs. 3); `householdText` says how. `note`: extra hints (e.g. Skabies:
 * an attest only when it comes back).
 */
export interface IfsgLocalRule {
  key: string
  custom: boolean
  name: string | null
  notifiable: boolean | null
  text: string | null
  rules: IfsgLocalDateRule[] | null
  proof: IfsgProof | null
  notify: boolean | null
  householdText: string | null
  householdExclusion: boolean | null
  note: string | null
  hint: string | null
}

/** A local rule with nothing set: everything as the RKI says. */
export const emptyLocalRule = (key: string): IfsgLocalRule => ({
  key, custom: false, name: null, notifiable: null, text: null, rules: null, proof: null, notify: null, householdText: null,
  householdExclusion: null, note: null, hint: null,
})

/** The most date rules a local rule holds. */
export const MAX_LOCAL_DATE_RULES = 3

/** Whether a local date rule is complete: a known anchor and 0–365 whole days. */
export function validLocalDateRule(rule: IfsgLocalDateRule): boolean {
  return IFSG_ANCHORS.includes(rule.anchor) && Number.isInteger(rule.days) && rule.days >= 0 && rule.days <= 365
}

export const isProof = (value: unknown): value is IfsgProof => typeof value === 'string' && (IFSG_PROOFS as readonly string[]).includes(value)

/** The local date rules as date rules of the engine (keys local1, local2 …). */
const toDateRules = (rules: IfsgLocalDateRule[]): IfsgDateRule[] =>
  rules.map((rule, index) => ({ key: `local${index + 1}`, anchor: rule.anchor, days: rule.days, label: rule.label, condition: '' }))

/** Whether any field of the sick's readmission is set locally. */
const sickIsLocal = (local: IfsgLocalRule) => local.text !== null || local.rules !== null || local.proof !== null || local.note !== null

/** The text of the sick with the local note appended. */
const withNote = (text: string, note: string | null) => (note ? `${text} ${note}`.trim() : text)

/** A local disease as a disease of the rules. */
function customDisease(local: IfsgLocalRule): IfsgDisease {
  const binding = local.notifiable === true
  const kinds: IfsgDisease['kinds'] = {
    sick: {
      text: withNote(local.text ?? '', local.note), proof: local.proof ?? 'none', rules: toDateRules(local.rules ?? []), source: 'local',
    },
  }
  if (local.householdExclusion === true) {
    kinds.household = { text: local.householdText ?? '', proof: local.proof ?? 'none', rules: [], source: 'local' }
  }
  return {
    key: local.key, name: local.name ?? local.key, notify: binding && (local.notify ?? true), binding, kinds, hint: local.hint ?? '',
    source: 'local',
  }
}

/**
 * The RKI catalogue with the local rules over it, field by field; local diseases follow (by name). A kind whose
 * readmission takes a local field says `source: 'local'`. The household: `householdExclusion` false drops the kind,
 * true adds it (with the RKI text unless a local one is set); the local text alone changes the RKI kind's text.
 */
export function mergeIfsgRules(rki: readonly IfsgDisease[], locals: readonly IfsgLocalRule[]): IfsgDisease[] {
  const byKey = new Map(locals.map(local => [local.key, local]))
  const merged = rki.map((disease): IfsgDisease => {
    const local = byKey.get(disease.key)
    if (!local || local.custom) return disease
    const kinds: IfsgDisease['kinds'] = { ...disease.kinds }
    const sick = disease.kinds.sick
    if (sick && sickIsLocal(local)) {
      kinds.sick = {
        text: withNote(local.text ?? sick.text, local.note), proof: local.proof ?? sick.proof,
        rules: local.rules === null ? sick.rules : toDateRules(local.rules), source: 'local',
      }
    }
    const household = disease.kinds.household
    if (local.householdExclusion === false) delete kinds.household
    else if (local.householdExclusion === true || (household && local.householdText !== null)) {
      kinds.household = {
        text: local.householdText ?? household?.text ?? '', proof: household?.proof ?? kinds.sick?.proof ?? 'medical_certificate',
        rules: household?.rules ?? [], source: 'local',
      }
    }
    return {
      ...disease, kinds, notify: local.notify ?? disease.notify, hint: local.hint ?? disease.hint,
      source: Object.values(kinds).some(kind => kind?.source === 'local') || local.notify !== null ? 'local' : 'rki',
    }
  })
  const custom = locals.filter(local => local.custom && !rki.some(disease => disease.key === local.key)).map(customDisease)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return [...merged, ...custom]
}

/** What a local rule changes against the RKI (for the marker „abweichend vom RKI“): proof, days, notification. */
export interface IfsgDifference {
  proof: { rki: IfsgProof; local: IfsgProof } | null
  /** The earliest days of each date rule, as „anchor + days“ pairs. */
  days: { rki: IfsgDateRuleSummary[]; local: IfsgDateRuleSummary[] } | null
  notify: { rki: boolean; local: boolean } | null
  household: { rki: boolean; local: boolean } | null
  text: boolean
}
export interface IfsgDateRuleSummary { anchor: IfsgAnchor; days: number }

const summary = (rule: Pick<IfsgKindRule, 'rules'> | undefined): IfsgDateRuleSummary[] =>
  (rule?.rules ?? []).map(entry => ({ anchor: entry.anchor, days: entry.days }))
const sameSummary = (a: IfsgDateRuleSummary[], b: IfsgDateRuleSummary[]) =>
  a.length === b.length && a.every((entry, index) => entry.anchor === b[index]!.anchor && entry.days === b[index]!.days)

/** The differences of the merged rule against the RKI one; null when nothing differs (or for a local disease). */
export function ifsgDifference(rki: IfsgDisease | null, merged: IfsgDisease): IfsgDifference | null {
  if (rki === null) return null
  const proof = rki.kinds.sick?.proof !== merged.kinds.sick?.proof
    ? { rki: rki.kinds.sick?.proof ?? 'medical_certificate', local: merged.kinds.sick?.proof ?? 'medical_certificate' } : null
  const days = sameSummary(summary(rki.kinds.sick), summary(merged.kinds.sick)) ? null : { rki: summary(rki.kinds.sick), local: summary(merged.kinds.sick) }
  const notify = rki.notify !== merged.notify ? { rki: rki.notify, local: merged.notify } : null
  const household = !!rki.kinds.household !== !!merged.kinds.household ? { rki: !!rki.kinds.household, local: !!merged.kinds.household } : null
  const text = rki.kinds.sick?.text !== merged.kinds.sick?.text || rki.kinds.household?.text !== merged.kinds.household?.text
  return proof || days || notify || household || text ? { proof, days, notify, household, text } : null
}

/** The days of a cluster (§ 34 Abs. 6 Satz 2): two or more children with the same disease within this many days. */
export const IFSG_CLUSTER_DAYS = 14

/** A cluster: the disease, the children, the first and last day of the window. */
export interface IfsgCluster { disease: string; count: number; from: IsoDate; to: IsoDate }

/**
 * The clusters to report: per disease the latest window of `IFSG_CLUSTER_DAYS` (the last case day and the 14 days
 * before it) with cases of two or more children, unless an acknowledgement covers its last day (`acknowledgedUpTo`:
 * per disease the last case day an acknowledgement covered).
 */
export function ifsgClusters(
  cases: readonly { disease: string; childId: number; reportedOn: IsoDate }[], acknowledgedUpTo: ReadonlyMap<string, IsoDate>,
): IfsgCluster[] {
  const byDisease = new Map<string, { childId: number; reportedOn: IsoDate }[]>()
  for (const entry of cases) byDisease.set(entry.disease, [...(byDisease.get(entry.disease) ?? []), entry])
  const result: IfsgCluster[] = []
  for (const [disease, entries] of byDisease) {
    const days = [...new Set(entries.map(entry => entry.reportedOn))].sort().reverse()
    for (const last of days) {
      const from = addDays(last, -IFSG_CLUSTER_DAYS)
      const inWindow = entries.filter(entry => entry.reportedOn >= from && entry.reportedOn <= last)
      const count = new Set(inWindow.map(entry => entry.childId)).size
      if (count < 2) continue
      const acknowledged = acknowledgedUpTo.get(disease)
      if (acknowledged === undefined || acknowledged < last) {
        result.push({ disease, count, from: inWindow.map(entry => entry.reportedOn).sort()[0]!, to: last })
      }
      break
    }
  }
  return result.sort((a, b) => b.to.localeCompare(a.to) || a.disease.localeCompare(b.disease))
}
