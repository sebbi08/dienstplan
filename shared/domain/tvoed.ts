import { addDays, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

/** Job titles of the social and educational service (TVöD SuE) used in a Kita; 'other' = free text. */
export const JOB_KEYS = [
  'childcare_worker', 'social_assistant', 'educator', 'educator_complex', 'curative_educator',
  'social_pedagogue', 'deputy_head', 'head', 'other',
] as const
export type JobKey = (typeof JOB_KEYS)[number]

export const PAY_GROUPS = [
  'S 2', 'S 3', 'S 4', 'S 7', 'S 8a', 'S 8b', 'S 9', 'S 10', 'S 11a', 'S 11b',
  'S 12', 'S 13', 'S 14', 'S 15', 'S 16', 'S 17', 'S 18',
] as const
export type PayGroup = (typeof PAY_GROUPS)[number]

/**
 * Usual pay group per job title, offered as a suggestion only (the actual grouping depends on the tasks and,
 * for the management, on the size of the facility; it must be checked).
 */
export const SUGGESTED_PAY_GROUP: Record<JobKey, PayGroup | null> = {
  childcare_worker: 'S 3', social_assistant: 'S 3', educator: 'S 8a', educator_complex: 'S 8b',
  curative_educator: 'S 8a', social_pedagogue: 'S 11b', deputy_head: null, head: null, other: null,
}

/** Years of service after which levels 2 to 6 are reached (TVöD SuE: 1, +3, +4, +4, +5 years). */
const LEVEL_AFTER_YEARS = [1, 4, 8, 12, 17]

function addYears(date: IsoDate, years: number): IsoDate {
  const { year, month, day } = parseIsoDate(date)
  // 29 February moves to 1 March in years without it.
  const target = toIsoDate(year + years, month, 1)
  return addDays(target, day - 1)
}

/** Level 1–6 by years of service since `since`, and when the next level is due (null at level 6). */
export function levelBySeniority(since: IsoDate, today: IsoDate): { level: number; nextLevel: number | null; nextOn: IsoDate | null } {
  const reached = LEVEL_AFTER_YEARS.filter(years => addYears(since, years) <= today).length
  const level = 1 + reached
  const next = LEVEL_AFTER_YEARS[reached]
  return next === undefined ? { level, nextLevel: null, nextOn: null } : { level, nextLevel: level + 1, nextOn: addYears(since, next) }
}

/** Completed years and months between `since` and `today` (0 when `since` lies in the future). */
export function seniority(since: IsoDate, today: IsoDate): { years: number; months: number } {
  if (since > today) return { years: 0, months: 0 }
  const from = parseIsoDate(since)
  const to = parseIsoDate(today)
  let months = (to.year - from.year) * 12 + (to.month - from.month)
  if (to.day < from.day) months -= 1
  return { years: Math.floor(months / 12), months: months % 12 }
}

/** Days before a level step from which it is announced. */
export const LEVEL_UP_NOTICE_DAYS = 30

/**
 * The next level step of an employee at `payLevel` who started on `since`, when it is due within
 * LEVEL_UP_NOTICE_DAYS (or already overdue); null otherwise, at level 6 or without a level.
 */
export function dueLevelUp(since: IsoDate, payLevel: number | null, today: IsoDate): { level: number; on: IsoDate } | null {
  if (payLevel === null || payLevel >= 6) return null
  const on = addYears(since, LEVEL_AFTER_YEARS[payLevel - 1]!)
  return on <= addDays(today, LEVEL_UP_NOTICE_DAYS) ? { level: payLevel + 1, on } : null
}
