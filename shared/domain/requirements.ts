import { daysInMonth, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

/** The mandatory appointments and proofs (Pflichttermine) every facility has; they can be renamed, but not deleted. */
export const BUILTIN_REQUIREMENTS = [
  { key: 'company_doctor', name: 'Betriebsarzt', intervalMonths: 24 },
  { key: 'first_aid', name: 'Erste-Hilfe-Kurs', intervalMonths: 24 },
  { key: 'criminal_record', name: 'Erweitertes Führungszeugnis', intervalMonths: 60 },
  { key: 'measles', name: 'Masernimpfung (Nachweis)', intervalMonths: null },
] as const satisfies readonly { key: string; name: string; intervalMonths: number | null }[]

export type BuiltinRequirementKey = (typeof BUILTIN_REQUIREMENTS)[number]['key']

/** Longest interval of a recurring kind (20 years). */
export const MAX_REQUIREMENT_INTERVAL_MONTHS = 240

/** A kind is announced to Leitung and Träger this many months before it is due. */
export const REQUIREMENT_SOON_MONTHS = 2

export type RequirementState = 'missing' | 'overdue' | 'soon' | 'ok'

/** The same day `months` later (or earlier), clamped to the end of a shorter month: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(date)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = index - targetYear * 12 + 1
  return toIsoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

/**
 * State of a kind for an employee whose newest record is dated `lastDate` (null = none), and the day the next one is
 * due (null without a record or for a kind needed once, `intervalMonths` null). Due today counts as overdue; due up to
 * and including REQUIREMENT_SOON_MONTHS from today counts as soon.
 */
export function requirementState(
  lastDate: IsoDate | null, intervalMonths: number | null, today: IsoDate,
): { state: RequirementState; dueOn: IsoDate | null } {
  if (lastDate === null) return { state: 'missing', dueOn: null }
  if (intervalMonths === null) return { state: 'ok', dueOn: null }
  const dueOn = addMonths(lastDate, intervalMonths)
  if (dueOn <= today) return { state: 'overdue', dueOn }
  return { state: dueOn <= addMonths(today, REQUIREMENT_SOON_MONTHS) ? 'soon' : 'ok', dueOn }
}
