import { daysInMonth, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

/**
 * The mandatory appointments and proofs (Pflichttermine) every facility has; they can be renamed, but not deleted. The
 * two examinations of the Jugendarbeitsschutzgesetz apply only to employees under 18 and are due by the law, not by an
 * interval (YOUTH_EXAM_KEYS, shared/domain/youthProtection.ts).
 *
 * `firstIntervalMonths`: the second record is due this many months after the start of employment, later ones after
 * `intervalMonths` (nextDueOn). The Betriebsarzt is the Pflichtvorsorge for biological agents in a Kita (ArbMedVV
 * Anhang Teil 2 Abs. 1 Nr. 3 Buchst. f, AMR 2.1): the first before the start (at most 3 months before), the second at
 * the latest 12 months after taking up the activity, then at the latest every 36 months. The Belehrung of § 34 Abs. 5a
 * IfSG is due before the first activity, then at least every 2 years. Existing facilities got the changes from the
 * migrations 0102 and 0103.
 */
export const BUILTIN_REQUIREMENTS = [
  { key: 'company_doctor', name: 'Betriebsarzt', intervalMonths: 36, firstIntervalMonths: 12 },
  { key: 'first_aid', name: 'Erste-Hilfe-Kurs', intervalMonths: 24, firstIntervalMonths: null },
  { key: 'criminal_record', name: 'Erweitertes Führungszeugnis', intervalMonths: 60, firstIntervalMonths: null },
  { key: 'measles', name: 'Masernimpfung (Nachweis)', intervalMonths: null, firstIntervalMonths: null },
  { key: 'youth_initial', name: 'Erstuntersuchung (§ 32 JArbSchG)', intervalMonths: null, firstIntervalMonths: null },
  { key: 'youth_followup', name: 'Nachuntersuchung (§ 33 JArbSchG)', intervalMonths: null, firstIntervalMonths: null },
  { key: 'ifsg_briefing', name: 'Belehrung Infektionsschutz (§ 34 Abs. 5a IfSG)', intervalMonths: 24, firstIntervalMonths: null },
] as const satisfies readonly { key: string; name: string; intervalMonths: number | null; firstIntervalMonths: number | null }[]

export type BuiltinRequirementKey = (typeof BUILTIN_REQUIREMENTS)[number]['key']

/**
 * The Pflichttermin „Erweitertes Führungszeugnis“: its entries hold the same § 72a Abs. 5 SGB VIII data as the inspection
 * record, so they take its retention (deletable from the day after leaving, at the latest 3 months after it) and no
 * note (400 requirement_note_not_allowed; notes from before stay until deleted by hand, listed in Datenschutz & Löschen).
 */
export const CRIMINAL_RECORD_KEY = 'criminal_record' satisfies BuiltinRequirementKey

/**
 * The kinds due before the first working day: the notice shows them for someone starting within
 * BEFORE_START_NOTICE_MONTHS already (the first examination of the JArbSchG has its own rule, youthExamStatus).
 */
export const BEFORE_START_KEYS = ['company_doctor', 'ifsg_briefing'] as const
export type BeforeStartKey = (typeof BEFORE_START_KEYS)[number]

export function isBeforeStartKey(key: string | null): key is BeforeStartKey {
  return key !== null && (BEFORE_START_KEYS as readonly string[]).includes(key)
}

/** AMR 2.1: the first Vorsorge at most 3 months before the start; the notice shows the kinds from then on. */
export const BEFORE_START_NOTICE_MONTHS = 3

type IntervalKind = { intervalMonths: number | null; firstIntervalMonths: number | null }

/**
 * When the next record of a recurring kind is due, from its record dates (at least one, any order; null for a kind
 * needed once). A kind with a first interval counts it from the start of employment (AMR 2.1: the first Vorsorge at
 * most 3 months before taking up the activity, the second at the latest 12 months after it). Only records from
 * start − 3 months on belong to this employment: none of them (all older) → due on the start (firstCheckupTooEarly);
 * exactly one, before start + first interval → it is the first check-up, the second is due at start + first interval.
 * Otherwise (more records, or a single later one, e.g. long-serving staff with only their latest check-up entered) the
 * interval counts from the newest record. Without a known start the first interval counts from a single record.
 */
export function nextDueOn(dates: readonly IsoDate[], kind: IntervalKind, start: IsoDate | null): IsoDate | null {
  if (kind.intervalMonths === null || dates.length === 0) return null
  const newest = dates.reduce((a, b) => (a > b ? a : b))
  if (kind.firstIntervalMonths !== null) {
    if (start === null) return addMonths(newest, dates.length === 1 ? kind.firstIntervalMonths : kind.intervalMonths)
    if (firstCheckupTooEarly(dates, kind, start)) return start
    const secondDue = addMonths(start, kind.firstIntervalMonths)
    if (dates.filter(date => date >= addMonths(start, -BEFORE_START_NOTICE_MONTHS)).length === 1 && newest < secondDue) return secondDue
  }
  return addMonths(newest, kind.intervalMonths)
}

/**
 * A kind with a first interval whose records all lie more than 3 months before the start of employment: no valid first
 * check-up of this employment (AMR 2.1), so it is due again on the start – before the start like a missing one.
 */
export function firstCheckupTooEarly(dates: readonly IsoDate[], kind: IntervalKind, start: IsoDate | null): start is IsoDate {
  if (kind.intervalMonths === null || kind.firstIntervalMonths === null || start === null || dates.length === 0) return false
  const earliestValid = addMonths(start, -BEFORE_START_NOTICE_MONTHS)
  return dates.every(date => date < earliestValid)
}

/** The examinations of the Jugendarbeitsschutzgesetz: only for employees under 18, due by the law (no interval). */
export const YOUTH_EXAM_KEYS = ['youth_initial', 'youth_followup'] as const
export type YouthExamKey = (typeof YOUTH_EXAM_KEYS)[number]

export function isYouthExamKey(key: string | null): key is YouthExamKey {
  return key !== null && (YOUTH_EXAM_KEYS as readonly string[]).includes(key)
}

/** Longest interval of a recurring kind (20 years). */
export const MAX_REQUIREMENT_INTERVAL_MONTHS = 240

/** Earliest day a record or training may be dated: an older one is a mistyped year (0202 for 2020). */
export const EARLIEST_REQUIREMENT_DATE: IsoDate = '1900-01-01'

/** Latest day a training may be dated: it may lie ahead (a booked course), but 3026 is a mistyped year. */
export const LATEST_TRAINING_DATE: IsoDate = '2100-12-31'

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
  return dueState(intervalMonths === null ? null : addMonths(lastDate, intervalMonths), today)
}

/** The state of a kind with a record whose next one is due on `dueOn` (null = needed once: ok for good). */
export function dueState(dueOn: IsoDate | null, today: IsoDate): { state: RequirementState; dueOn: IsoDate | null } {
  if (dueOn === null) return { state: 'ok', dueOn: null }
  if (dueOn <= today) return { state: 'overdue', dueOn }
  return { state: dueOn <= addMonths(today, REQUIREMENT_SOON_MONTHS) ? 'soon' : 'ok', dueOn }
}
