import { asc, eq, inArray } from 'drizzle-orm'
import {
  ageLimitCounts, ageLimitRuleError, ageLimitViolations, firstAgeLimitViolations, monthsFrom,
  type AgeLimitChild, type AgeLimitRule, type AgeLimitViolation, type GroupAgeRule,
} from '../../shared/domain/ageLimits'
import type { OccupancyChild } from '../../shared/domain/occupancy'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import type { IsoDate } from '../../shared/domain/types'
import type { AgeLimitRuleDto, AgeLimitWarningDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { children, groupAgeLimits } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertGroup, listGroups } from './groups'
import { occupancyChildren } from './schoolChildren'

/**
 * The age limits of the groups („von 0 bis unter 3 Jahren: höchstens 5 Kinder“) and their warnings: in the Belegung,
 * as the hint on the Kinder page and after a save. One computation for all of them (`ageLimitViolations`), with the
 * children the Belegung counts. The warnings look at the coming twelve months, from today's month on.
 */

export const AGE_LIMIT_HORIZON_MONTHS = 12
export const MAX_AGE_LIMITS_PER_GROUP = 20

const ruleOrder = [asc(groupAgeLimits.fromYears), asc(groupAgeLimits.toYears), asc(groupAgeLimits.id)]

/** The age limits of a group of the facility, by age (404 group_not_found for another facility's group). */
export function listGroupAgeLimits(db: Db, facilityId: number, groupId: number): AgeLimitRuleDto[] {
  assertGroup(db, facilityId, groupId)
  return db.select({ fromYears: groupAgeLimits.fromYears, toYears: groupAgeLimits.toYears, maxChildren: groupAgeLimits.maxChildren })
    .from(groupAgeLimits).where(eq(groupAgeLimits.groupId, groupId)).orderBy(...ruleOrder).all()
}

/**
 * Replaces the age limits of a group of the facility. Each rule needs whole years 0 to 18 with „von“ below „bis
 * unter“ and a number of children from 0 to 200 (400 with the German error's code); at most 20 rules
 * (400 age_limits_too_many). 404 group_not_found for another facility's group.
 */
export function setGroupAgeLimits(db: Db, facilityId: number, groupId: number, rules: AgeLimitRule[]): void {
  assertGroup(db, facilityId, groupId)
  if (rules.length > MAX_AGE_LIMITS_PER_GROUP) throw new ServiceError(400, 'age_limits_too_many')
  for (const rule of rules) {
    const error = ageLimitRuleError(rule)
    if (error) throw new ServiceError(400, error)
  }
  db.transaction((tx) => {
    tx.delete(groupAgeLimits).where(eq(groupAgeLimits.groupId, groupId)).run()
    for (const { fromYears, toYears, maxChildren } of rules) {
      tx.insert(groupAgeLimits).values({ groupId, fromYears, toYears, maxChildren }).run()
    }
  })
}

/** The facility's age limits, by the groups' order and then by age. */
export function facilityAgeRules(db: Db, facilityId: number): GroupAgeRule[] {
  const groups = listGroups(db, facilityId)
  if (groups.length === 0) return []
  const rows = db.select().from(groupAgeLimits).where(inArray(groupAgeLimits.groupId, groups.map(group => group.id)))
    .orderBy(...ruleOrder).all()
  return groups.flatMap(group => rows.filter(row => row.groupId === group.id)
    .map(({ id, groupId, fromYears, toYears, maxChildren }) => ({ id, groupId, fromYears, toYears, maxChildren })))
}

/** The children the Belegung counts (`counted`, when the caller has them already), with their birth dates. */
export function ageLimitChildren(
  db: Db, facilityId: number, counted: OccupancyChild[] = occupancyChildren(db, facilityId).children,
): AgeLimitChild[] {
  if (counted.length === 0) return []
  const births = new Map(db.select({ id: children.id, birthDate: children.birthDate }).from(children)
    .where(eq(children.facilityId, facilityId)).all().map(row => [row.id, row.birthDate]))
  return counted.map(child => ({ ...child, birthDate: births.get(child.id)! }))
}

function toWarning(violation: AgeLimitViolation, groupNames: Map<number, string>): AgeLimitWarningDto {
  const { groupId, rule, year, month, count } = violation
  return {
    groupId, groupName: groupNames.get(groupId) ?? '', fromYears: rule.fromYears, toYears: rule.toYears,
    maxChildren: rule.maxChildren, count, year, month,
  }
}

const namesOf = (db: Db, facilityId: number) => new Map(listGroups(db, facilityId).map(group => [group.id, group.name]))

/** The hint on the Kinder page: per group and rule the first month of the coming twelve it is exceeded in. */
export function upcomingAgeLimitWarnings(db: Db, facilityId: number, today: IsoDate): AgeLimitWarningDto[] {
  const rules = facilityAgeRules(db, facilityId)
  if (rules.length === 0) return []
  const violations = ageLimitViolations(ageLimitChildren(db, facilityId), rules, monthsFrom(today, AGE_LIMIT_HORIZON_MONTHS))
  const names = namesOf(db, facilityId)
  return firstAgeLimitViolations(violations).map(violation => toWarning(violation, names))
}

/** The rules and months a child counts for (`<ruleId>:<year>-<month>`), of the coming twelve months. */
export type AgeLimitCells = Set<string>

const cellKey = (ruleId: number, year: number, month: number) => `${ruleId}:${year}-${month}`

function cellsOf(childId: number, rules: GroupAgeRule[], all: AgeLimitChild[], today: IsoDate): AgeLimitCells {
  const child = all.find(candidate => candidate.id === childId)
  if (!child) return new Set()
  return new Set(ageLimitCounts([child], rules, monthsFrom(today, AGE_LIMIT_HORIZON_MONTHS))
    .filter(entry => entry.count > 0).map(entry => cellKey(entry.rule.id, entry.year, entry.month)))
}

/** The rules and months the child counts for before a save (none for a child that is still to be created). */
export function ageLimitCells(db: Db, facilityId: number, childId: number | null, today: IsoDate): AgeLimitCells {
  if (childId === null) return new Set()
  const rules = facilityAgeRules(db, facilityId)
  if (rules.length === 0) return new Set()
  return cellsOf(childId, rules, ageLimitChildren(db, facilityId), today)
}

/**
 * The warnings after a save that puts a child into a group's age range (a new child, a group change, a planned one, a
 * contract, a leaving taken back): per group and rule the first month of the coming twelve the save added the child to
 * in which the rule is exceeded. It never blocks the save. Only for Leitung and Träger (children.manage), as the hint
 * on the Kinder page; everybody else gets none.
 */
export function ageLimitWarnings(
  db: Db, viewer: { permissions: ReadonlySet<PermissionKey> }, facilityId: number, childId: number, before: AgeLimitCells, today: IsoDate,
): AgeLimitWarningDto[] {
  if (!can(viewer.permissions, 'children.manage')) return []
  const rules = facilityAgeRules(db, facilityId)
  if (rules.length === 0) return []
  const all = ageLimitChildren(db, facilityId)
  const added = [...cellsOf(childId, rules, all, today)].filter(cell => !before.has(cell))
  if (added.length === 0) return []
  const addedSet = new Set(added)
  const violations = ageLimitViolations(all, rules, monthsFrom(today, AGE_LIMIT_HORIZON_MONTHS))
    .filter(violation => addedSet.has(cellKey(violation.rule.id, violation.year, violation.month)))
  const names = namesOf(db, facilityId)
  return firstAgeLimitViolations(violations).map(violation => toWarning(violation, names))
}
