import { QUALIFICATIONS, type AddOn, type DemandRule, type HoursBand, type PresenceRule, type StaffingRuleSet } from './types'

/**
 * Träger overrides of a state preset ("Personalschlüssel" settings).
 *
 * Every numeric value of a preset has a stable path: `fteHoursPerWeek`, `staffShares.<qualification>`,
 * `demand.<row>.<field>`, `addOns.<key>.<field>`, `presence.<rule>.<field>`, `quotas.<key>.pct`. Demand rows and presence
 * rules have no key of their own: their key is made of their conditions (`regel+mit-u3`, `haupt+krippe+ab11`, `all`),
 * so it means the same row in every version and every state, and never the row that happens to be at that index.
 * Conditions themselves (group type, age band, hours bands, minimum children) select a row and are not values; the
 * same holds for the limits of a step table (`addOns.leitung.steps.bis4.fte`, `….steps.rest.fte`).
 *
 * An override remembers the preset value it replaced. It applies to a version only where that version has the path
 * with the same preset value: when a new version of the law changes the number, the new law value wins.
 */
export interface StoredOverride {
  value: number
  /** The preset value the override replaced (the version valid when it was set). */
  preset: number
}

/** The overrides of a facility by path. */
export type StaffingOverrides = Record<string, StoredOverride>

export interface OverridableValue {
  path: string
  value: number
}

interface Slot extends OverridableValue {
  set: (value: number) => void
}

const DEMAND_FIELDS = [
  'childrenPerFte', 'fteUnits', 'refHoursPerWeek', 'staffHoursPerChildHour', 'childHoursPerStaffHour',
  'countedWeeklyHours', 'childWeight', 'ftePerGroup', 'refHoursPerDay', 'referenceChildren',
] as const satisfies readonly (keyof DemandRule)[]
const ADD_ON_FIELDS = ['pct', 'fte', 'hours', 'firstGroupHours', 'minFte', 'capFte'] as const satisfies readonly (keyof AddOn)[]
const PRESENCE_FIELDS = ['minStaff', 'minFachkraft'] as const satisfies readonly (keyof PresenceRule)[]

/** German decimal comma, so a key never contains the path separator. */
const num = (value: number) => String(value).replace('.', ',')

function bandKey(prefix: string, band: HoursBand | { atLeast?: number; below?: number } | undefined): string | null {
  if (!band) return null
  const b = band as HoursBand
  const parts = [
    b.over !== undefined ? `>${num(b.over)}` : '',
    b.atLeast !== undefined ? `>=${num(b.atLeast)}` : '',
    b.upTo !== undefined ? `<=${num(b.upTo)}` : '',
    b.below !== undefined ? `<${num(b.below)}` : '',
  ].join('')
  return `${prefix}${parts}`
}

/** The key of a demand row, made of its conditions ('all' for a row without any). */
export function demandKey(rule: DemandRule): string {
  const parts = [
    rule.groupType ?? null,
    rule.ageBand ?? null,
    bandKey('m', rule.ageMonths),
    bandKey('h', rule.weeklyHours),
    rule.withAgeBand !== undefined ? `mit-${rule.withAgeBand}` : null,
    rule.minChildren !== undefined ? `ab${num(rule.minChildren)}` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join('+') : 'all'
}

/** The key of a presence rule: its window, group types and minimum children. */
export function presenceKey(rule: PresenceRule): string {
  return [
    rule.window,
    rule.groupTypes?.length ? rule.groupTypes.join(',') : null,
    rule.minChildren !== undefined ? `ab${num(rule.minChildren)}` : null,
  ].filter((part): part is string => part !== null).join('+')
}

/** Makes keys unique within a list: a second row with the same key gets `#2` (never reached in practice). */
function uniqueKeys(keys: string[]): string[] {
  const seen = new Map<string, number>()
  return keys.map((key) => {
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count === 1 ? key : `${key}#${count}`
  })
}

function numericSlots<T extends object>(prefix: string, target: T, fields: readonly (keyof T)[]): Slot[] {
  return fields.flatMap((field) => {
    const value = target[field]
    if (typeof value !== 'number') return []
    return [{ path: `${prefix}.${String(field)}`, value, set: (v: number) => { (target as Record<string, unknown>)[field as string] = v } }]
  })
}

/** Every numeric value of the rule set with its path; setters write into `rules` (only call them on a copy). */
function slots(rules: StaffingRuleSet): Slot[] {
  const result: Slot[] = []
  result.push({ path: 'fteHoursPerWeek', value: rules.fteHoursPerWeek, set: (v) => { rules.fteHoursPerWeek = v } })
  for (const q of QUALIFICATIONS) {
    result.push({ path: `staffShares.${q}`, value: rules.staffShares[q], set: (v) => { rules.staffShares[q] = v } })
  }
  const demandKeys = uniqueKeys(rules.demand.map(demandKey))
  rules.demand.forEach((rule, i) => {
    const prefix = `demand.${demandKeys[i]}`
    result.push(...numericSlots(prefix, rule, DEMAND_FIELDS))
    if (rule.weeklyHoursPerGroup) {
      result.push(...numericSlots(`${prefix}.weeklyHoursPerGroup`, rule.weeklyHoursPerGroup, ['total', 'minFachkraft', 'leitung']))
    }
  })
  rules.addOns.forEach((addOn) => {
    const prefix = `addOns.${addOn.key}`
    result.push(...numericSlots(prefix, addOn, ADD_ON_FIELDS))
    // A step is named by its limit (`bis4`, `rest` for the open end), which is its identity like a row condition.
    const stepKeys = uniqueKeys((addOn.steps ?? []).map(step => (step.upTo === null ? 'rest' : `bis${num(step.upTo)}`)))
    addOn.steps?.forEach((step, i) => {
      result.push(...numericSlots(`${prefix}.steps.${stepKeys[i]}`, step, ['fte']))
    })
  })
  const presenceKeys = uniqueKeys(rules.presence.map(presenceKey))
  rules.presence.forEach((rule, i) => {
    const prefix = `presence.${presenceKeys[i]}`
    result.push(...numericSlots(prefix, rule, PRESENCE_FIELDS))
    if (rule.perChildren) result.push(...numericSlots(`${prefix}.perChildren`, rule.perChildren, ['children', 'staff', 'fachkraft']))
    if (rule.childWeights) result.push(...numericSlots(`${prefix}.childWeights`, rule.childWeights, ['u3', 'ue3', 'school']))
    if (rule.relaxFachkraft) result.push(...numericSlots(`${prefix}.relaxFachkraft`, rule.relaxFachkraft, ['maxChildren', 'minFachkraft']))
  })
  for (const quota of rules.quotas) {
    if (quota.kind !== 'demand_minimum') result.push(...numericSlots(`quotas.${quota.key}`, quota, ['pct']))
  }
  return result
}

/** Every value the Träger may change, with its path, in the order of the rule set. */
export function overridableValues(rules: StaffingRuleSet): OverridableValue[] {
  return slots(rules).map(({ path, value }) => ({ path, value }))
}

/** A deep, unfrozen copy of a rule set (presets are deep-frozen). */
export function copyRuleSet(rules: StaffingRuleSet): StaffingRuleSet {
  return structuredClone(rules) as StaffingRuleSet
}

/**
 * The preset with the overrides that apply to it, as a new object (the preset stays untouched). `applied` lists the
 * paths that changed a value, `ignored` those the version has no place for or whose preset value differs from the one
 * the override replaced. The result is not checked: call ruleSetProblems on it.
 */
export function applyOverrides(
  preset: StaffingRuleSet, overrides: StaffingOverrides,
): { rules: StaffingRuleSet; applied: string[]; ignored: string[] } {
  const rules = copyRuleSet(preset)
  const byPath = new Map(slots(rules).map(slot => [slot.path, slot]))
  const applied: string[] = []
  const ignored: string[] = []
  for (const [path, override] of Object.entries(overrides)) {
    const slot = byPath.get(path)
    if (!slot || slot.value !== override.preset) {
      ignored.push(path)
      continue
    }
    slot.set(override.value)
    applied.push(path)
  }
  return { rules, applied, ignored }
}
