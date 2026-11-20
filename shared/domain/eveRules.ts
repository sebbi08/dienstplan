import { parseIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * How 24 and 31 December count for a facility's staff in a year: a whole or half leave day, or paid free (TVöD § 6
 * Abs. 3, or the facility's own choice; like a public holiday for the staff: no leave, no target hours). The facility
 * keeps a history (server table facility_eve_rules): the rule of a year is the entry with the latest `fromYear` not
 * after it, so a change applies from its year on and never to the years before.
 */
export const EVE_MODES = ['whole', 'half', 'paid'] as const
export type EveMode = (typeof EVE_MODES)[number]

export interface EveRule {
  fromYear: number
  mode: EveMode
}

/** The rule of `year`: the entry with the latest fromYear not after it; without one a whole leave day. */
export function eveModeIn(rules: readonly EveRule[] | undefined, year: number): EveMode {
  return eveRuleOf(rules ?? [], year)?.mode ?? 'whole'
}

/** The entry that decides `year` (null when none does). */
export function eveRuleOf(rules: readonly EveRule[], year: number): EveRule | null {
  let found: EveRule | null = null
  for (const rule of rules) {
    if (rule.fromYear <= year && (found === null || rule.fromYear > found.fromYear)) found = rule
  }
  return found
}

/**
 * The first year a change saved on `today` applies to: this year until 23 December, from 24 December on the next year
 * (this year's 24 December has come, its plan and leave are settled).
 */
export function effectiveEveYear(today: IsoDate): number {
  const { year } = parseIsoDate(today)
  return today.slice(5) < '12-24' ? year : year + 1
}

/**
 * Whether a leave day on `date` weighs half a day (24 or 31 December in a year whose rule is 'half'). `half` is the
 * facility's rule history, or a plain yes/no for every year.
 */
export function halfOnEveDay(date: IsoDate, half: boolean | readonly EveRule[]): boolean {
  if (!(date.endsWith('-12-24') || date.endsWith('-12-31'))) return false
  return typeof half === 'boolean' ? half : eveModeIn(half, parseIsoDate(date).year) === 'half'
}
