import { isValidIsoDate } from '../dates'
import {
  QUALIFICATIONS,
  type AddOn, type AgeBand, type DemandChild, type DemandInput, type DemandRule, type HoursBand,
  type Planned, type PlannedStaff, type Qualification, type QuotaLine, type Requirement,
  type RequirementLine, type StaffingRuleSet,
} from './types'

export const DEMAND_LABEL = 'Grundbedarf'
export const DEFAULT_FACHKRAFT: Qualification[] = ['fachkraft']

export function inHoursBand(hours: number, band: HoursBand | undefined): boolean {
  if (band === undefined) return true
  if (band.over !== undefined && !(hours > band.over)) return false
  if (band.atLeast !== undefined && !(hours >= band.atLeast)) return false
  if (band.upTo !== undefined && !(hours <= band.upTo)) return false
  if (band.below !== undefined && !(hours < band.below)) return false
  return true
}

function childMatches(rule: DemandRule, groupType: string | null, child: DemandChild): boolean {
  if (rule.groupType !== undefined && rule.groupType !== groupType) return false
  if (rule.ageBand !== undefined && rule.ageBand !== child.ageBand) return false
  if (rule.ageMonths !== undefined) {
    if (child.ageMonths === undefined) return false
    const { atLeast, below } = rule.ageMonths
    if (atLeast !== undefined && child.ageMonths < atLeast) return false
    if (below !== undefined && child.ageMonths >= below) return false
  }
  return inHoursBand(child.weeklyHours, rule.weeklyHours)
}

function groupMatches(rule: DemandRule, input: DemandInput): boolean {
  if (rule.groupType !== undefined && rule.groupType !== input.groupType) return false
  if (rule.withAgeBand !== undefined && !input.children.some(c => c.ageBand === rule.withAgeBand)) return false
  if (rule.minChildren !== undefined && input.children.length < rule.minChildren) return false
  return true
}

const weightOf = (rule: DemandRule, child: DemandChild) => Math.max(rule.childWeight ?? 1, child.weight ?? 0)

/** Staff hours per week a child-hours row demands for one child. */
function childHours(rule: DemandRule, child: DemandChild): number {
  const hours = (rule.countedWeeklyHours ?? child.weeklyHours) * weightOf(rule, child)
  if (rule.staffHoursPerChildHour !== undefined) return hours * rule.staffHoursPerChildHour
  if (rule.childHoursPerStaffHour) return hours / rule.childHoursPerStaffHour
  return 0
}

/** FTE a child-ratio row demands for one child. */
function childFte(rule: DemandRule, child: DemandChild): number {
  if (!rule.childrenPerFte) return 0
  const scale = rule.refHoursPerWeek ? child.weeklyHours / rule.refHoursPerWeek : 1
  return (rule.fteUnits ?? 1) / rule.childrenPerFte * weightOf(rule, child) * scale
}

interface Demand { fte: number; fachkraftFte: number; leitungFte: number; unmatched: number }

function demandOf(rules: StaffingRuleSet, input: DemandInput): Demand {
  const fteHours = rules.fteHoursPerWeek
  const result: Demand = { fte: 0, fachkraftFte: 0, leitungFte: 0, unmatched: 0 }
  if (rules.method === 'group_fte') {
    if (input.children.length === 0) return result
    const rule = rules.demand.find(r => groupMatches(r, input))
    if (rule === undefined) return { ...result, unmatched: input.children.length }
    const scale = rule.refHoursPerDay && input.openingMinutesPerDay !== null
      ? input.openingMinutesPerDay / 60 / rule.refHoursPerDay
      : 1
    return { ...result, fte: (rule.ftePerGroup ?? 0) * scale }
  }
  for (const child of input.children) {
    const rule = rules.demand.find(r => childMatches(r, input.groupType, child))
    if (rule === undefined) {
      result.unmatched++
    } else if (rules.method === 'fte_per_child') {
      result.fte += childFte(rule, child)
    } else if (rules.method === 'child_hours') {
      result.fte += childHours(rule, child) / fteHours
    } else {
      const table = rule.weeklyHoursPerGroup
      const reference = rule.referenceChildren
      if (table === undefined || !reference) continue
      result.fte += table.total / reference / fteHours
      result.fachkraftFte += (table.minFachkraft ?? 0) / reference / fteHours
      result.leitungFte += (table.leitung ?? 0) / reference / fteHours
    }
  }
  return result
}

export interface AddOnContext {
  children: { ageBand: AgeBand; weeklyHours: number }[]
  groupCount: number
  /** Base demand (without add-ons) of the scope. */
  demandFte: number
}

function addOnFte(addOn: AddOn, ctx: AddOnContext, fteHours: number): number {
  let raw = 0
  switch (addOn.mode) {
    case 'pct_of_demand':
      raw = ctx.demandFte * (addOn.pct ?? 0) / 100
      break
    case 'fte_per_child':
      raw = ctx.children.filter(c =>
        (addOn.ageBand === undefined || addOn.ageBand === c.ageBand) && inHoursBand(c.weeklyHours, addOn.weeklyHours),
      ).length * (addOn.fte ?? 0)
      break
    case 'hours_per_group': {
      const hours = addOn.hours ?? 0
      const first = addOn.firstGroupHours ?? hours
      raw = ctx.groupCount > 0 ? (first + hours * (ctx.groupCount - 1)) / fteHours : 0
      break
    }
    case 'fte_flat':
      raw = addOn.fte ?? 0
      break
    case 'step_table': {
      const value = addOn.basis === 'children' ? ctx.children.length : ctx.demandFte
      raw = (addOn.steps ?? []).find(s => s.upTo === null || value <= s.upTo)?.fte ?? 0
      break
    }
  }
  if (raw <= 0) return 0
  if (addOn.minFte !== undefined) raw = Math.max(raw, addOn.minFte)
  if (addOn.capFte !== undefined) raw = Math.min(raw, addOn.capFte)
  return raw
}

function addOnLines(rules: StaffingRuleSet, scope: AddOn['scope'], ctx: AddOnContext): RequirementLine[] {
  return rules.addOns
    .filter(a => a.scope === scope)
    .map(a => ({ key: a.key, label: a.label, fte: addOnFte(a, ctx, rules.fteHoursPerWeek), counts: a.counts }))
}

/** Required FTE of one group: base demand by the state's method plus the group add-ons. */
export function requiredFte(rules: StaffingRuleSet, input: DemandInput): Requirement {
  const demand = demandOf(rules, input)
  const lines: RequirementLine[] = [{ key: 'demand', label: DEMAND_LABEL, fte: demand.fte, counts: true }]
  if (demand.leitungFte > 0) lines.push({ key: 'leitung', label: 'Leitungszeit', fte: demand.leitungFte, counts: false })
  lines.push(...addOnLines(rules, 'group', { children: input.children, groupCount: 1, demandFte: demand.fte }))
  return {
    fte: lines.reduce((sum, l) => sum + (l.counts ? l.fte : 0), 0),
    demandFte: demand.fte,
    fachkraftFte: demand.fachkraftFte,
    lines,
    unmatchedChildren: demand.unmatched,
  }
}

/** The facility-wide add-ons (e.g. Leitung by number of groups), computed once for the facility. */
export function facilityAddOns(rules: StaffingRuleSet, ctx: AddOnContext): RequirementLine[] {
  return addOnLines(rules, 'facility', ctx)
}

const fachkraftSet = (rules: StaffingRuleSet) => rules.fachkraftQualifications ?? DEFAULT_FACHKRAFT

/** Counting share in percent: the employee's own, else the state's default; 100 without qualification. */
export function shareOf(rules: StaffingRuleSet, qualification: Qualification | null, share: number | null | undefined): number {
  if (share !== null && share !== undefined) return share
  return qualification === null ? 100 : rules.staffShares[qualification]
}

export function isFachkraft(rules: StaffingRuleSet, qualification: Qualification | null): boolean {
  return qualification !== null && fachkraftSet(rules).includes(qualification)
}

/** Planned FTE: hours × share ÷ (full-time hours per week × weeks of the period). */
export function plannedFte(rules: StaffingRuleSet, staff: PlannedStaff[], weeks: number): Planned {
  const byQualification = Object.fromEntries(QUALIFICATIONS.map(q => [q, 0])) as Record<Qualification, number>
  const result: Planned = { fte: 0, fachkraftFte: 0, byQualification, unqualifiedFte: 0 }
  const fullTime = rules.fteHoursPerWeek * weeks
  if (!(fullTime > 0)) return result
  for (const s of staff) {
    const fte = s.hours * shareOf(rules, s.qualification, s.share) / 100 / fullTime
    result.fte += fte
    if (s.qualification === null) result.unqualifiedFte += fte
    else byQualification[s.qualification] += fte
    if (isFachkraft(rules, s.qualification)) result.fachkraftFte += fte
  }
  return result
}

/** One line per quota of the state, with the limit, the planned value and whether it holds. */
export function quotaLines(rules: StaffingRuleSet, required: Requirement, planned: Planned): QuotaLine[] {
  return rules.quotas.map((quota) => {
    const have = quota.qualifications.reduce((sum, q) => sum + planned.byQualification[q], 0)
    if (quota.kind === 'demand_minimum') {
      const limit = required.fachkraftFte
      return { key: quota.key, label: quota.label, kind: quota.kind, limit, have, ok: have >= limit }
    }
    const limit = (quota.base === 'required' ? required.fte : planned.fte) * quota.pct / 100
    const ok = quota.kind === 'min_share' ? have >= limit : have <= limit
    return { key: quota.key, label: quota.label, kind: quota.kind, limit, have, ok }
  })
}

const positive = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value > 0

function demandProblem(rules: StaffingRuleSet, rule: DemandRule): string | null {
  switch (rules.method) {
    case 'fte_per_child':
      return positive(rule.childrenPerFte) ? null : 'childrenPerFte must be > 0'
    case 'child_hours':
      return positive(rule.staffHoursPerChildHour) !== positive(rule.childHoursPerStaffHour)
        ? null
        : 'exactly one of staffHoursPerChildHour / childHoursPerStaffHour must be > 0'
    case 'group_fte':
      return positive(rule.ftePerGroup) ? null : 'ftePerGroup must be > 0'
    case 'group_pauschale':
      return positive(rule.weeklyHoursPerGroup?.total) && positive(rule.referenceChildren)
        ? null
        : 'weeklyHoursPerGroup.total and referenceChildren must be > 0'
  }
}

function addOnProblem(addOn: AddOn): string | null {
  switch (addOn.mode) {
    case 'pct_of_demand': return addOn.pct === undefined ? 'pct missing' : null
    case 'fte_per_child':
    case 'fte_flat': return addOn.fte === undefined ? 'fte missing' : null
    case 'hours_per_group': return addOn.hours === undefined && addOn.firstGroupHours === undefined ? 'hours missing' : null
    case 'step_table': return addOn.steps?.length ? null : 'steps missing'
  }
}

/** Data errors of a rule set (empty = usable); for presets and Träger overrides. */
export function ruleSetProblems(rules: StaffingRuleSet): string[] {
  const problems: string[] = []
  if (!isValidIsoDate(rules.validFrom)) problems.push(`validFrom: not a date (${rules.validFrom})`)
  if (!positive(rules.fteHoursPerWeek)) problems.push('fteHoursPerWeek must be > 0')
  if (rules.demand.length === 0) problems.push('demand: no rows')
  rules.demand.forEach((rule, i) => {
    const problem = demandProblem(rules, rule)
    if (problem) problems.push(`demand[${i}]: ${problem}`)
  })
  rules.addOns.forEach((addOn, i) => {
    const problem = addOnProblem(addOn)
    if (problem) problems.push(`addOns[${i}] (${addOn.key}): ${problem}`)
  })
  for (const q of QUALIFICATIONS) {
    const share = rules.staffShares[q]
    if (!(share >= 0 && share <= 100)) problems.push(`staffShares.${q}: must be 0–100 (${share})`)
  }
  return problems
}
