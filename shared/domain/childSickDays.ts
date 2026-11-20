import { parseIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * Kinderkrankentage (§ 45 SGB V): days off with sick pay from the health insurer when a child is ill. Eligible is a
 * child under 12, or one with a disability that depends on help (any age). The entitlement per year is so many days
 * per eligible child up to a maximum, higher for single parents. The values change by law from time to time: without
 * own values of the Träger every year gets its legal values (childSickDefaults); values the Träger stored count for
 * every year. Entering „Kind krank“ is never blocked, the plan only warns. Days of § 45 Abs. 1a (child in hospital,
 * one parent admitted with it) and Abs. 4 (terminally ill child) have no cap; the app cannot tell them apart and counts
 * them like the others (the settings say so).
 */

export interface ChildSickSettings {
  /** Days per eligible child. */
  perChild: number
  /** At most per year, whatever the number of children. */
  maxPerYear: number
  /** The same for single parents („alleinerziehend“). */
  singleParentPerChild: number
  singleParentMax: number
}

export const CHILD_SICK_SETTING_KEYS = ['perChild', 'maxPerYear', 'singleParentPerChild', 'singleParentMax'] as const
/** § 45 Abs. 2 SGB V: the lasting values, again from 2027. */
export const CHILD_SICK_STATUTORY: ChildSickSettings = { perChild: 10, maxPerYear: 25, singleParentPerChild: 20, singleParentMax: 50 }
/** § 45 Abs. 2a SGB V: the raised values, by law for 2024 to 2026 (Stand 19.11.2026: not extended to 2027). */
export const CHILD_SICK_RAISED: ChildSickSettings = { perChild: 15, maxPerYear: 35, singleParentPerChild: 30, singleParentMax: 70 }
/** The last year of the raised values. */
export const CHILD_SICK_RAISED_UNTIL = 2026

/**
 * The legal values of a year: the raised ones up to 2026 (years before 2024 are not modelled; the app had only these
 * values before), the lasting ones of § 45 Abs. 2 from 2027.
 */
export function childSickDefaults(year: number): ChildSickSettings {
  return { ...(year <= CHILD_SICK_RAISED_UNTIL ? CHILD_SICK_RAISED : CHILD_SICK_STATUTORY) }
}

/**
 * Stored values that hold a raised value of 2026 (any value equal to its 2026 value, not to the lasting one): stored
 * values count for every year, so the settings say – already in 2026 – that these apply by law only up to 2026.
 */
export function childSickOutdated(settings: ChildSickSettings): boolean {
  return CHILD_SICK_SETTING_KEYS.some(key => settings[key] === CHILD_SICK_RAISED[key] && settings[key] !== CHILD_SICK_STATUTORY[key])
}
/** A child counts until this birthday. */
export const CHILD_SICK_AGE_LIMIT = 12
/** The Pflegeversicherung counts the children under this age (Beitragsabschlag ab dem 2. Kind). */
export const CARE_INSURANCE_CHILD_AGE = 25
/** Highest value a setting may take. */
export const CHILD_SICK_SETTING_MAX = 365

export interface ChildFacts {
  birthDate: IsoDate
  disabledDependent: boolean
}

/** The day the child turns `age` (ISO text; 29 February stays 29 February, which sorts before 1 March). */
function birthdayAt(birthDate: IsoDate, age: number): string {
  const { year } = parseIsoDate(birthDate)
  return `${year + age}${birthDate.slice(4)}`
}

/** Under 12 on at least one day of the year (born by its end), or disabled and dependent on help. */
export function isEligibleChildInYear(child: ChildFacts, year: number): boolean {
  if (child.birthDate > `${year}-12-31`) return false
  return child.disabledDependent || birthdayAt(child.birthDate, CHILD_SICK_AGE_LIMIT) > `${year}-01-01`
}

/** Born by that day and under 12 on it, or disabled and dependent on help: offered for „Kind krank“ on that day. */
export function isEligibleChildOn(child: ChildFacts, date: IsoDate): boolean {
  if (child.birthDate > date) return false
  return child.disabledDependent || birthdayAt(child.birthDate, CHILD_SICK_AGE_LIMIT) > date
}

/** The entitlement of the year: min(per child × eligible children, maximum), the single parent values when single. */
export function childSickEntitlement(
  children: readonly ChildFacts[], singleParent: boolean, year: number, settings: ChildSickSettings,
): { eligibleChildren: number; days: number } {
  const eligibleChildren = children.filter(child => isEligibleChildInYear(child, year)).length
  const perChild = singleParent ? settings.singleParentPerChild : settings.perChild
  const max = singleParent ? settings.singleParentMax : settings.maxPerYear
  return { eligibleChildren, days: Math.min(perChild * eligibleChildren, max) }
}

/**
 * The settings must be whole days from 0 to 365, each maximum at least the days for one child; otherwise
 * child_sick_settings_invalid.
 */
export function childSickSettingsError(settings: ChildSickSettings): 'child_sick_settings_invalid' | null {
  const valid = CHILD_SICK_SETTING_KEYS.every(key => Number.isInteger(settings[key]) && settings[key] >= 0 && settings[key] <= CHILD_SICK_SETTING_MAX)
    && settings.maxPerYear >= settings.perChild && settings.singleParentMax >= settings.singleParentPerChild
  return valid ? null : 'child_sick_settings_invalid'
}

/**
 * For the Pflegeversicherung (Kinderlosenzuschlag, Beitragsabschlag ab dem 2. Kind), as of `today`: a parent with any
 * child born, and the number of children under 25.
 */
export function parentStatus(children: readonly ChildFacts[], today: IsoDate): { parent: boolean; childrenUnder25: number } {
  const born = children.filter(child => child.birthDate <= today)
  return {
    parent: born.length > 0,
    childrenUnder25: born.filter(child => birthdayAt(child.birthDate, CARE_INSURANCE_CHILD_AGE) > today).length,
  }
}
