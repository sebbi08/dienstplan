import { FTE_EPSILON } from '#shared/domain/staffing/calc'
import { demandKey, presenceKey } from '#shared/domain/staffing/overrides'
import {
  QUALIFICATIONS, type AgeBand, type DemandRule, type HoursBand, type PresenceRule, type StaffingRuleSet,
} from '#shared/domain/staffing/types'
// Relative, so the domain tests can load it without the Nuxt aliases.
import { de } from '../locales/de'

/**
 * Display helpers of the Personalschlüssel: numbers in German notation and the settings' values grouped and labelled.
 * The paths are those of shared/domain/staffing/overrides.ts (the same walk over the rule set); a test checks that every
 * value of every state's preset gets a label here.
 */

export interface StaffingField {
  path: string
  label: string
  /** Shown after the number ('%', 'Std./Woche', …); empty for plain numbers. */
  unit: string
}

/** A row of the rule set (a demand row, an add-on, …) with its values; title null = the section has a single block. */
export interface StaffingBlock {
  title: string | null
  fields: StaffingField[]
}

export type StaffingSectionKey = 'demand' | 'presence' | 'shares' | 'addOns' | 'quotas' | 'fte'

export interface StaffingSection {
  key: StaffingSectionKey
  title: string
  blocks: StaffingBlock[]
}

const t = de.staffing

/** FTE with two decimals and a German comma: 1,80. */
export function formatFte(value: number): string {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Ist − Soll with its sign: +0,20, −0,80, 0,00 (only a true zero has none). A value that merely rounds to zero shows
 * as < −0,01 / < +0,01, so a red row never reads 0,00.
 */
export function formatSignedFte(value: number): string {
  if (Math.abs(value) <= FTE_EPSILON) return formatFte(0)
  if (Math.abs(value) < 0.005) return value > 0 ? '< +0,01' : '< −0,01'
  return `${value > 0 ? '+' : '−'}${formatFte(Math.abs(value))}`
}

/** A quota line's name with its effective percentage (the Träger may have changed it): Fachkraftquote mind. 50 %. */
export function quotaLabel(line: { label: string; kind: 'min_share' | 'max_share' | 'demand_minimum'; pct?: number }): string {
  if (line.kind === 'demand_minimum' || line.pct === undefined) return line.label
  return `${line.label} ${line.kind === 'min_share' ? 'mind.' : 'höchstens'} ${formatDecimal(line.pct)} %`
}

/** A preset value as typed in a form: 4,5014 (no rounding to two places, no thousands separator). */
export function formatDecimal(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: false })
}

/** A typed number with comma or point; null when it is not a plain decimal number. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

const num = formatDecimal

function hoursBandText(band: HoursBand): string {
  const parts = [
    band.over !== undefined ? `über ${num(band.over)}` : null,
    band.atLeast !== undefined ? `ab ${num(band.atLeast)}` : null,
    band.upTo !== undefined ? `bis ${num(band.upTo)}` : null,
    band.below !== undefined ? `unter ${num(band.below)}` : null,
  ].filter(Boolean)
  return `${parts.join(' ')} ${t.hoursPerWeek}`
}

function monthsText(band: { atLeast?: number; below?: number }): string {
  const parts = [
    band.atLeast !== undefined ? `ab ${num(band.atLeast)}` : null,
    band.below !== undefined ? `unter ${num(band.below)}` : null,
  ].filter(Boolean)
  return t.ageMonths(parts.join(' bis '))
}

function groupTypeLabel(rules: StaffingRuleSet, key: string): string {
  return rules.groupTypes?.find(type => type.key === key)?.label ?? key
}

/** The conditions of a demand row in words: „Regelgruppe, mit Kindern unter 3“, „unter 3 Jahre, bis 25 Std./Woche“. */
export function demandTitle(rules: StaffingRuleSet, rule: DemandRule): string {
  const parts = [
    rule.groupType !== undefined ? groupTypeLabel(rules, rule.groupType) : null,
    rule.ageBand !== undefined ? t.ageBands[rule.ageBand] : null,
    rule.ageMonths !== undefined ? monthsText(rule.ageMonths) : null,
    rule.weeklyHours !== undefined ? hoursBandText(rule.weeklyHours) : null,
    rule.withAgeBand !== undefined ? t.withAgeBand[rule.withAgeBand] : null,
    rule.minChildren !== undefined ? t.fromChildren(rule.minChildren) : null,
  ].filter((part): part is string => part !== null)
  return parts.length ? parts.join(', ') : t.allChildren
}

/** A presence rule in words: „Hauptbetreuungszeit, Ganztagsgruppe / Kinderkrippe“. */
export function presenceTitle(rules: StaffingRuleSet, rule: PresenceRule): string {
  const parts = [
    t.windows[rule.window],
    rule.groupTypes?.length ? rule.groupTypes.map(key => groupTypeLabel(rules, key)).join(' / ') : null,
    rule.minChildren !== undefined ? t.fromPresentChildren(rule.minChildren) : null,
  ].filter((part): part is string => part !== null)
  return parts.join(', ')
}

/** Same as overrides.ts: a second row with the same key gets `#2`. */
function uniqueKeys(keys: string[]): string[] {
  const seen = new Map<string, number>()
  return keys.map((key) => {
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count === 1 ? key : `${key}#${count}`
  })
}

type FieldSpec = readonly [field: string, label: string, unit?: string]

/** The fields of `target` that hold a number, in the order of `specs`. */
function numberFields(prefix: string, target: object, specs: readonly FieldSpec[]): StaffingField[] {
  const record = target as Record<string, unknown>
  return specs
    .filter(([field]) => typeof record[field] === 'number')
    .map(([field, label, unit = '']) => ({ path: `${prefix}.${field}`, label, unit }))
}

const f = t.fields

const DEMAND_SPECS: readonly FieldSpec[] = [
  ['ftePerGroup', f.ftePerGroup],
  ['refHoursPerDay', f.refHoursPerDay, t.hoursPerDay],
  ['childrenPerFte', f.childrenPerFte],
  ['fteUnits', f.fteUnits],
  ['refHoursPerWeek', f.refHoursPerWeek, t.hoursPerWeek],
  ['childHoursPerStaffHour', f.childHoursPerStaffHour],
  ['staffHoursPerChildHour', f.staffHoursPerChildHour],
  ['countedWeeklyHours', f.countedWeeklyHours, t.hoursPerWeek],
  ['childWeight', f.childWeight],
  ['referenceChildren', f.referenceChildren],
]

function demandBlocks(rules: StaffingRuleSet): StaffingBlock[] {
  const keys = uniqueKeys(rules.demand.map(demandKey))
  return rules.demand.map((rule, index) => {
    const prefix = `demand.${keys[index]}`
    const fields = numberFields(prefix, rule, DEMAND_SPECS)
    if (rule.weeklyHoursPerGroup) {
      fields.push(...numberFields(`${prefix}.weeklyHoursPerGroup`, rule.weeklyHoursPerGroup, [
        ['total', f.groupHoursTotal, t.hoursPerWeek],
        ['minFachkraft', f.groupHoursFachkraft, t.hoursPerWeek],
        ['leitung', f.groupHoursLeitung, t.hoursPerWeek],
      ]))
    }
    return { title: demandTitle(rules, rule), fields }
  })
}

function presenceBlocks(rules: StaffingRuleSet): StaffingBlock[] {
  const keys = uniqueKeys(rules.presence.map(presenceKey))
  return rules.presence.map((rule, index) => {
    const prefix = `presence.${keys[index]}`
    const fields = numberFields(prefix, rule, [['minStaff', f.minStaff], ['minFachkraft', f.minFachkraft]])
    if (rule.perChildren) {
      fields.push(...numberFields(`${prefix}.perChildren`, rule.perChildren, [
        ['children', f.perChildren], ['staff', f.perChildrenStaff], ['fachkraft', f.perChildrenFachkraft],
      ]))
    }
    if (rule.childWeights) {
      fields.push(...numberFields(`${prefix}.childWeights`, rule.childWeights, (['u3', 'ue3', 'school'] as AgeBand[])
        .map(band => [band, f.childWeightOf(t.ageBands[band])] as const)))
    }
    if (rule.relaxFachkraft) {
      fields.push(...numberFields(`${prefix}.relaxFachkraft`, rule.relaxFachkraft, [
        ['maxChildren', f.relaxMaxChildren], ['minFachkraft', f.relaxMinFachkraft],
      ]))
    }
    return { title: presenceTitle(rules, rule), fields }
  })
}

function addOnBlocks(rules: StaffingRuleSet): StaffingBlock[] {
  return rules.addOns.map((addOn) => {
    const prefix = `addOns.${addOn.key}`
    const fields = numberFields(prefix, addOn, [
      ['pct', f.pctOfDemand, '%'],
      ['fte', addOn.mode === 'fte_per_child' ? f.ftePerChild : f.fteFlat],
      ['firstGroupHours', f.firstGroupHours, t.hoursPerWeek],
      ['hours', addOn.firstGroupHours !== undefined ? f.furtherGroupHours : f.hoursPerGroup, t.hoursPerWeek],
      ['minFte', f.minFte],
      ['capFte', f.capFte],
    ])
    const steps = addOn.steps ?? []
    const stepKeys = uniqueKeys(steps.map(step => (step.upTo === null ? 'rest' : `bis${String(step.upTo).replace('.', ',')}`)))
    steps.forEach((step, index) => {
      const limit = step.upTo === null ? null : num(step.upTo)
      fields.push({ path: `${prefix}.steps.${stepKeys[index]}.fte`, label: f.step(limit, addOn.basis ?? 'demand_fte'), unit: '' })
    })
    return { title: addOn.label + (addOn.counts ? '' : ` (${t.shownOnly})`), fields }
  })
}

/**
 * The values of a rule set in the order the settings show them: Bedarf, Mindestbesetzung, Anrechnung, Zuschläge,
 * Quoten, Vollzeit. Sections without values are left out.
 */
export function staffingSections(rules: StaffingRuleSet): StaffingSection[] {
  const byGroup = rules.method === 'group_fte' || rules.method === 'group_pauschale'
  const sections: StaffingSection[] = [
    { key: 'demand', title: byGroup ? t.sections.demandGroup : t.sections.demandAge, blocks: demandBlocks(rules) },
    { key: 'presence', title: t.sections.presence, blocks: presenceBlocks(rules) },
    {
      key: 'shares',
      title: t.sections.shares,
      blocks: [{ title: null, fields: QUALIFICATIONS.map(q => ({ path: `staffShares.${q}`, label: t.qualifications[q], unit: '%' })) }],
    },
    { key: 'addOns', title: t.sections.addOns, blocks: addOnBlocks(rules) },
    {
      key: 'quotas',
      title: t.sections.quotas,
      blocks: rules.quotas.flatMap(quota => (quota.kind === 'demand_minimum'
        ? []
        : [{ title: quota.label, fields: [{ path: `quotas.${quota.key}.pct`, label: quota.kind === 'min_share' ? f.quotaMin : f.quotaMax, unit: '%' }] }])),
    },
    { key: 'fte', title: t.sections.fte, blocks: [{ title: null, fields: [{ path: 'fteHoursPerWeek', label: f.fteHoursPerWeek, unit: t.hoursPerWeek }] }] },
  ]
  return sections
    .map(section => ({ ...section, blocks: section.blocks.filter(block => block.fields.length > 0) }))
    .filter(section => section.blocks.length > 0)
}

/**
 * The label of a path for the notes about overrides that no longer apply: „Bedarf je Altersgruppe – unter 3 Jahre:
 * Kinder je Vollzeitkraft“. The rule sets are searched in order (today's version first, then the others), since an
 * ignored path may only exist in an older version. Unknown paths are shown as they are.
 */
export function staffingPathLabel(path: string, ruleSets: readonly StaffingRuleSet[]): string {
  for (const rules of ruleSets) {
    for (const section of staffingSections(rules)) {
      for (const block of section.blocks) {
        const field = block.fields.find(candidate => candidate.path === path)
        if (field) return `${[section.title, block.title].filter(Boolean).join(' – ')}: ${field.label}`
      }
    }
  }
  return path
}
