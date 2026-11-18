import { ageOn } from './children'
import { parseIsoDate, toIsoDate } from './dates'
import { groupCell, type OccupancyChild } from './occupancy'
import type { IsoDate } from './types'

/**
 * Age limits per group: „von ‹A› bis unter ‹B› Jahren: höchstens ‹N› Kinder“. A group may have several rules, also
 * overlapping ones („0 bis unter 3: 5“ and „2 bis unter 3: 3“); each is checked on its own.
 *
 * A child's age in a month is its age on the 1st of that month (a child born on the 1st is a year older in its birthday
 * month already, one born on the 2nd only from the next month on). The children counted for a group and month are
 * those the occupancy (Belegung) counts there: present and future contracts, with their group changes and leaving days.
 */

export const AGE_LIMIT_MAX_YEARS = 18
export const AGE_LIMIT_MAX_CHILDREN = 200

export interface AgeLimitRule {
  fromYears: number
  toYears: number
  maxChildren: number
}

export interface GroupAgeRule extends AgeLimitRule {
  id: number
  groupId: number
}

export interface AgeLimitChild extends OccupancyChild {
  birthDate: IsoDate
}

/** A rule in a month with the children of its group in its age range then (a violation: more than the rule allows). */
export interface AgeLimitViolation {
  groupId: number
  rule: GroupAgeRule
  year: number
  month: number
  count: number
  childIds: number[]
}

export type AgeLimitRuleError = 'age_limit_years_invalid' | 'age_limit_range_invalid' | 'age_limit_max_invalid'

/** The age in completed years on the 1st of the month (negative before the birth). */
export function ageOnFirstOfMonth(birthDate: IsoDate, year: number, month: number): number {
  return ageOn(birthDate, toIsoDate(year, month, 1)).years
}

/** Whole years 0 to 18 with from below to, and a whole number of children from 0 to 200; else the German error's code. */
export function ageLimitRuleError(rule: AgeLimitRule): AgeLimitRuleError | null {
  const isYears = (value: number) => Number.isInteger(value) && value >= 0 && value <= AGE_LIMIT_MAX_YEARS
  if (!isYears(rule.fromYears) || !isYears(rule.toYears)) return 'age_limit_years_invalid'
  if (rule.fromYears >= rule.toYears) return 'age_limit_range_invalid'
  if (!Number.isInteger(rule.maxChildren) || rule.maxChildren < 0 || rule.maxChildren > AGE_LIMIT_MAX_CHILDREN) return 'age_limit_max_invalid'
  return null
}

/** `count` months from the month of `day` on. */
export function monthsFrom(day: IsoDate, count: number): { year: number; month: number }[] {
  const { year, month } = parseIsoDate(day)
  return Array.from({ length: count }, (_, index) => {
    const number = year * 12 + month - 1 + index
    return { year: Math.floor(number / 12), month: (number % 12) + 1 }
  })
}

/**
 * Per rule and month given, the children of the rule's group in its age range (also none). Rule by rule in the order
 * given, each in the months' order.
 */
export function ageLimitCounts(
  children: AgeLimitChild[], rules: GroupAgeRule[], months: { year: number; month: number }[],
): AgeLimitViolation[] {
  const byId = new Map(children.map(child => [child.id, child]))
  const counted = new Map<string, number[]>()
  const inGroup = (groupId: number, year: number, month: number) => {
    const key = `${groupId}:${year}:${month}`
    let ids = counted.get(key)
    if (!ids) {
      const cell = groupCell(children, groupId, year, month)
      ids = [...cell.present, ...cell.fresh].map(entry => entry.childId)
      counted.set(key, ids)
    }
    return ids
  }
  return rules.flatMap(rule => months.map(({ year, month }) => {
    const childIds = inGroup(rule.groupId, year, month).filter((id) => {
      const age = ageOnFirstOfMonth(byId.get(id)!.birthDate, year, month)
      return age >= rule.fromYears && age < rule.toYears
    })
    return { groupId: rule.groupId, rule, year, month, count: childIds.length, childIds }
  }))
}

/** Every rule exceeded in every month given: more children of its group in its age range than it allows. */
export function ageLimitViolations(
  children: AgeLimitChild[], rules: GroupAgeRule[], months: { year: number; month: number }[],
): AgeLimitViolation[] {
  return ageLimitCounts(children, rules, months).filter(entry => entry.count > entry.rule.maxChildren)
}

/** Of the violations, the first month of each group and rule (the first one given), in their order. */
export function firstAgeLimitViolations(violations: AgeLimitViolation[]): AgeLimitViolation[] {
  const seen = new Set<number>()
  return violations.filter((violation) => {
    if (seen.has(violation.rule.id)) return false
    seen.add(violation.rule.id)
    return true
  })
}
