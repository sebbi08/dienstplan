import { parseIsoDate, todayIso } from '../../shared/domain/dates'
import {
  FTE_EPSILON, facilityAddOns, hasPeriodCheck, mergeLines, requiredFte,
} from '../../shared/domain/staffing/calc'
import { averageOpening } from '../../shared/domain/staffing/day'
import type { AgeBand, DemandChild, Requirement, StaffingRuleSet } from '../../shared/domain/staffing/types'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import type {
  GroupDto, StaffingEstimateAssumptionsDto, StaffingEstimateCurrentDto, StaffingEstimateDto, StaffingEstimateFacilityDto,
  StaffingEstimateGroupDto, StaffingEstimatePresenceDto, StaffingEstimatePreviewDto, StaffingEstimateReason,
  StaffingEstimatesDto, StaffingFiguresDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { assertGroup, listGroups } from './groups'
import { loadHoursContext } from './openingHours'
import { staffingRulesFor } from './staffing'
import { monthCareDays, staffingMonth } from './staffingReport'

/**
 * The Personalschlüssel of a group if all its places were taken („volle Belegung“), shown in the group settings while
 * a group is set up and afterwards (planning help, no legal check). The state's engine counts (calc.ts); this module
 * only decides which children to assume:
 * - as many children as places, all full-time: weekly hours = the group's average opening per day × 5, from the same
 *   source as the monthly report (the group's own hours, else the facility's, on this month's care days); without any
 *   entered hours the reference hours of the group type (group_fte), else nothing can be computed (per-child states);
 * - their age band from the group type (see the maps below), else 3 years to school; a group that has children under 3
 *   now counts as „mit U3“: exactly one place under 3.
 * „Aktuell“ is the Soll of this month's Personalschlüssel tab (staffingMonth), never computed differently.
 */

/**
 * Group types of the presets that are only for children under 3 (the presets carry no such flag): BW, NI, SL and HB
 * „krippe“, NW „gf2“ (Gruppenform II, unter 3 Jahre). Keep in step with shared/domain/staffing/presets.
 */
export const U3_GROUP_TYPES: ReadonlySet<string> = new Set(['krippe', 'gf2'])
/** Group types of the presets that are for school children only (NI and HB „hort“). */
export const SCHOOL_GROUP_TYPES: ReadonlySet<string> = new Set(['hort'])

export interface EstimateGroupInput {
  groupType: string | null
  capacity: number | null
  /** A group for school children (after-school care): its places count as school children. */
  forSchoolChildren: boolean
  /** Average opening per day of the group (own hours, else the facility's); null = none entered. */
  openingMinutesPerDay: Minutes | null
  /** The group has children under 3 now: it counts as mixed „mit U3“. */
  hasU3Now: boolean
}

interface Computed {
  dto: StaffingEstimateDto
  /** The assumed children and the base demand, for the facility surcharges; null = no estimate. */
  children: DemandChild[] | null
  demandFte: number
}

function presenceOf(rules: StaffingRuleSet, groupType: string | null): StaffingEstimatePresenceDto[] {
  return rules.presence
    .filter(rule => rule.groupTypes === undefined || (groupType !== null && rule.groupTypes.includes(groupType)))
    .map(rule => ({
      window: rule.window,
      minStaff: rule.minStaff ?? null,
      minFachkraft: rule.minFachkraft ?? null,
      minChildren: rule.minChildren ?? null,
      perChildren: rule.perChildren
        ? { children: rule.perChildren.children, staff: rule.perChildren.staff, fachkraft: rule.perChildren.fachkraft ?? null }
        : null,
    }))
}

function ageBandOf(input: EstimateGroupInput): AgeBand {
  if (input.groupType !== null && U3_GROUP_TYPES.has(input.groupType)) return 'u3'
  if (input.forSchoolChildren || (input.groupType !== null && SCHOOL_GROUP_TYPES.has(input.groupType))) return 'school'
  return 'ue3'
}

/** The reference opening per day of the group type's first row with one (BW), in minutes; null without. */
function referenceMinutes(rules: StaffingRuleSet, groupType: string | null): Minutes | null {
  if (rules.method !== 'group_fte') return null
  const row = rules.demand.find(rule => (rule.groupType === undefined || rule.groupType === groupType) && rule.refHoursPerDay)
  return row?.refHoursPerDay ? row.refHoursPerDay * 60 : null
}

function compute(rules: StaffingRuleSet, input: EstimateGroupInput): Computed {
  const types = rules.groupTypes ?? []
  const groupTypeLabel = types.find(type => type.key === input.groupType)?.label ?? null
  const periodCheck = hasPeriodCheck(rules)
  const empty = (reason: StaffingEstimateReason | null): Computed => ({
    dto: {
      groupType: input.groupType, groupTypeLabel, capacity: input.capacity, reason, periodCheck,
      fte: null, hoursPerWeek: null, fachkraftFte: 0, lines: [], withU3Fte: null, unmatchedChildren: 0, assumptions: null,
      presence: presenceOf(rules, input.groupType),
    },
    children: null,
    demandFte: 0,
  })

  // A state without group types calculates without them: a stored type is ignored.
  if (types.length > 0 && input.groupType === null) return empty('no_group_type')
  if (types.length > 0 && groupTypeLabel === null) return empty('unknown_group_type')
  if (!periodCheck) return empty(null)
  if (input.capacity === null || input.capacity < 1) return empty('no_capacity')

  let minutes = input.openingMinutesPerDay
  let hoursSource: StaffingEstimateAssumptionsDto['hoursSource'] = 'opening'
  if (minutes === null) {
    minutes = referenceMinutes(rules, input.groupType)
    hoursSource = minutes === null ? 'none' : 'reference'
    // Only the group methods can do without hours (their FTE do not depend on the children's hours).
    if (minutes === null && rules.method !== 'group_fte') return empty('no_opening_hours')
  }
  const weeklyHours = minutes === null ? null : minutes * 5 / 60
  const band = ageBandOf(input)
  const u3 = band === 'ue3' && input.hasU3Now ? 1 : 0
  const child = (ageBand: AgeBand): DemandChild => ({ ageBand, weeklyHours: weeklyHours ?? 0 })
  const children = Array.from({ length: input.capacity }, (_, i) => child(i < u3 ? 'u3' : band))
  const required = (list: DemandChild[]): Requirement =>
    requiredFte(rules, { groupType: input.groupType, openingMinutesPerDay: minutes, children: list })
  const result = required(children)

  // What one child under 3 would change (BW „mit U3“, the per-child ratios), when none was assumed.
  let withU3Fte: number | null = null
  if (band === 'ue3' && u3 === 0) {
    const alternative = required([child('u3'), ...children.slice(1)]).fte
    if (Math.abs(alternative - result.fte) > FTE_EPSILON) withU3Fte = alternative
  }

  return {
    dto: {
      groupType: input.groupType, groupTypeLabel, capacity: input.capacity, reason: null, periodCheck,
      fte: result.fte,
      hoursPerWeek: result.fte * rules.fteHoursPerWeek,
      fachkraftFte: result.fachkraftFte,
      lines: result.lines,
      withU3Fte,
      unmatchedChildren: result.unmatchedChildren,
      assumptions: {
        children: input.capacity, u3: band === 'u3' ? input.capacity : u3, school: band === 'school' ? input.capacity : 0,
        weeklyHoursPerChild: weeklyHours, hoursSource,
      },
      presence: presenceOf(rules, input.groupType),
    },
    children,
    demandFte: result.demandFte,
  }
}

/** The Personalschlüssel of one group at full occupancy (pure; the reason says what is missing). */
export function estimateGroup(rules: StaffingRuleSet, input: EstimateGroupInput): StaffingEstimateDto {
  return compute(rules, input).dto
}

/**
 * The facility at full occupancy: the counting FTE of the groups with an estimate plus the facility surcharges, with
 * those groups counted for them (BW Leitung 6 h for the first group, 2 h for each further one) and their children.
 */
export function estimateFacility(rules: StaffingRuleSet, inputs: EstimateGroupInput[]): Omit<StaffingEstimateFacilityDto, 'current'> {
  const periodCheck = hasPeriodCheck(rules)
  const computed = inputs.map(input => compute(rules, input))
  const estimated = computed.filter(entry => entry.children !== null)
  const groupsWithout = computed.length - estimated.length
  if (!periodCheck || estimated.length === 0) {
    return { periodCheck, groupCount: estimated.length, groupsWithout, fte: null, hoursPerWeek: null, lines: [] }
  }
  const facilityLines = facilityAddOns(rules, {
    children: estimated.flatMap(entry => entry.children ?? []),
    groupCount: estimated.length,
    demandFte: estimated.reduce((sum, entry) => sum + entry.demandFte, 0),
  })
  const fte = estimated.reduce((sum, entry) => sum + (entry.dto.fte ?? 0), 0)
    + facilityLines.reduce((sum, line) => sum + (line.counts ? line.fte : 0), 0)
  return {
    periodCheck,
    groupCount: estimated.length,
    groupsWithout,
    fte,
    hoursPerWeek: fte * rules.fteHoursPerWeek,
    lines: mergeLines([...estimated.flatMap(entry => entry.dto.lines), ...facilityLines]),
  }
}

const currentOf = (figures: StaffingFiguresDto | undefined): StaffingEstimateCurrentDto | null =>
  figures === undefined ? null : { children: figures.children.total, u3: figures.children.u3, fte: figures.required.fte }

interface EstimateGroup { group: Pick<GroupDto, 'id' | 'name' | 'groupType' | 'capacity' | 'forSchoolChildren'>; isNew: boolean }

/** Everything both routes need: the rules of today, this month's tab, the groups' opening and the estimates. */
function build(db: Db, facilityId: number, today: IsoDate, adjust: (groups: EstimateGroup[]) => EstimateGroup[]) {
  const { rules, preset } = staffingRulesFor(db, facilityId, today)
  const { year, month } = parseIsoDate(today)
  const report = staffingMonth(db, facilityId, year, month)
  const periodCheck = hasPeriodCheck(rules)
  const hours = loadHoursContext(db, facilityId)
  const careDays = monthCareDays(db, facilityId, year, month)
  const rows = new Map(report.groups.map(row => [row.groupId, row]))

  const entries = adjust(listGroups(db, facilityId).map(group => ({ group, isNew: false }))).map(({ group, isNew }) => {
    const row = isNew ? undefined : rows.get(group.id)
    const input: EstimateGroupInput = {
      groupType: group.groupType,
      capacity: group.capacity,
      forSchoolChildren: group.forSchoolChildren,
      openingMinutesPerDay: averageOpening(hours, careDays, isNew ? null : group.id),
      hasU3Now: (row?.children.u3 ?? 0) > 0,
    }
    const estimate: StaffingEstimateGroupDto = {
      ...estimateGroup(rules, input),
      groupId: isNew ? null : group.id,
      name: group.name,
      current: periodCheck && !isNew ? currentOf(row) ?? { children: 0, u3: 0, fte: 0 } : null,
    }
    return { input, estimate }
  })
  const facility: StaffingEstimateFacilityDto = {
    ...estimateFacility(rules, entries.map(entry => entry.input)),
    current: periodCheck ? currentOf(report.total) : null,
  }
  const meta = { land: rules.land, fteHoursPerWeek: rules.fteHoursPerWeek, confidence: preset.confidence }
  return { meta, groups: entries.map(entry => entry.estimate), facility }
}

/** GET /api/staffing/estimate: every group of the facility and the facility at full occupancy, with „Aktuell“. */
export function staffingEstimate(db: Db, facilityId: number, today: IsoDate = todayIso()): StaffingEstimatesDto {
  const { meta, groups, facility } = build(db, facilityId, today, list => list)
  return { ...meta, groups, facility }
}

export interface EstimatePreviewInput {
  groupType: string | null
  capacity: number | null
  /** The group being edited (its opening hours count); null = a group not created yet (the facility's hours). */
  groupId: number | null
}

/**
 * GET /api/staffing/estimate/preview: the estimate of a group with the given type and places while it is created or
 * edited, and the facility with it (the edited group replaced, a new one added); 404 group_not_found for a group of
 * another facility.
 */
export function staffingEstimatePreview(
  db: Db, facilityId: number, input: EstimatePreviewInput, today: IsoDate = todayIso(),
): StaffingEstimatePreviewDto {
  assertGroup(db, facilityId, input.groupId)
  const values = { groupType: input.groupType, capacity: input.capacity }
  const { meta, groups, facility } = build(db, facilityId, today, (list) => {
    if (input.groupId !== null) {
      return list.map(entry => (entry.group.id === input.groupId ? { ...entry, group: { ...entry.group, ...values } } : entry))
    }
    return [...list, { group: { id: 0, name: '', forSchoolChildren: false, ...values }, isNew: true }]
  })
  const group = input.groupId === null ? groups[groups.length - 1]! : groups.find(entry => entry.groupId === input.groupId)!
  return { ...meta, group, facility }
}
