import { isValidIsoDate, parseIsoDate, toIsoDate, daysInMonth } from './dates'
import { emailError } from './personnel'
import type { IsoDate } from './types'

/**
 * „Infogespräche & Hospitationen“ (Mehr, server/services/visits.ts): info visits of families before a Vormerkung and
 * the visits of applicants (Bewerbung, Hospitation, Praktikum) with their days. The rules both sides share: statuses,
 * limits, the checks of the input and the retention dates (deleted by hand under Mehr → Löschfristen).
 */

export const INFO_VISIT_STATUSES = ['open', 'waitlisted', 'declined'] as const
export type InfoVisitStatus = typeof INFO_VISIT_STATUSES[number]
export const APPLICANT_KINDS = ['bewerbung', 'hospitation', 'praktikum'] as const
export type ApplicantKind = typeof APPLICANT_KINDS[number]
export const APPLICANT_STATUSES = ['open', 'hired', 'declined'] as const
export type ApplicantStatus = typeof APPLICANT_STATUSES[number]

export const VISIT_LIMITS = {
  name: 120, phone: 50, email: 200, notes: 2000, guidedByName: 100, documentTitle: 200, days: 30,
} as const

/** Open applicants without any activity are listed under Löschfristen („ohne Abschluss“) this many months after it. */
export const OPEN_APPLICANT_MONTHS = 12

/** Domain error with a machine-readable code; the services answer it as 400. */
export class VisitError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'VisitError'
  }
}

/** The ISO date `months` calendar months after `date`; a day the month lacks becomes its last day (31.01. + 1 → 28./29.02.). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(date)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = index - nextYear * 12 + 1
  return toIsoDate(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
}

const text = (value: unknown, max: number, code: string): string => {
  if (typeof value !== 'string') throw new VisitError('invalid_input')
  const trimmed = value.trim()
  if (trimmed.length > max) throw new VisitError(code)
  return trimmed
}

const optionalDate = (value: unknown, code: string): IsoDate | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !isValidIsoDate(value)) throw new VisitError(code)
  return value
}

const minutes = (value: unknown, code: string): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) throw new VisitError(code)
  return value
}

const email = (value: unknown): string => {
  const checked = text(value, VISIT_LIMITS.email, 'email_invalid')
  if (emailError(checked)) throw new VisitError('email_invalid')
  return checked
}

const optionalId = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new VisitError('invalid_input')
  return value
}

export interface InfoVisitFields {
  visitDate: IsoDate
  /** Minutes after midnight, null = no time. */
  visitStart: number | null
  familyName: string
  phone: string
  email: string
  childFirstName: string
  childLastName: string
  childBirthDate: IsoDate | null
  desiredStart: IsoDate | null
  guidedByEmployeeId: number | null
  /** „Geführt von“ as free text (e.g. someone without an employee entry); shown when no employee is chosen. */
  guidedByName: string
  notes: string
}

/**
 * An info visit as stored: texts trimmed and within their limits (400 visit_text_too_long, notes_too_long), a real visit
 * date (visit_date_invalid) and time (visit_time_invalid), a family name (visit_name_required), a valid e-mail address
 * or none (email_invalid), a birth date not after `today` (birth_date_invalid / birth_date_in_future), a desired start
 * (desired_start_invalid).
 */
export function checkInfoVisit(input: Record<string, unknown>, today: IsoDate): InfoVisitFields {
  const visitDate = optionalDate(input.visitDate, 'visit_date_invalid')
  if (visitDate === null) throw new VisitError('visit_date_invalid')
  const familyName = text(input.familyName, VISIT_LIMITS.name, 'visit_text_too_long')
  if (familyName === '') throw new VisitError('visit_name_required')
  const childBirthDate = optionalDate(input.childBirthDate, 'birth_date_invalid')
  if (childBirthDate !== null && childBirthDate > today) throw new VisitError('birth_date_in_future')
  const guidedByEmployeeId = optionalId(input.guidedByEmployeeId)
  return {
    visitDate,
    visitStart: minutes(input.visitStart, 'visit_time_invalid'),
    familyName,
    phone: text(input.phone, VISIT_LIMITS.phone, 'visit_text_too_long'),
    email: email(input.email),
    childFirstName: text(input.childFirstName, VISIT_LIMITS.name, 'visit_text_too_long'),
    childLastName: text(input.childLastName, VISIT_LIMITS.name, 'visit_text_too_long'),
    childBirthDate,
    desiredStart: optionalDate(input.desiredStart, 'desired_start_invalid'),
    guidedByEmployeeId,
    // The chosen employee wins; the free text stays only without one.
    guidedByName: guidedByEmployeeId === null ? text(input.guidedByName ?? '', VISIT_LIMITS.guidedByName, 'visit_text_too_long') : '',
    notes: text(input.notes ?? '', VISIT_LIMITS.notes, 'notes_too_long'),
  }
}

export interface ApplicantDay {
  date: IsoDate
  /** Minutes after midnight, null = not given. */
  from: number | null
  to: number | null
}

export interface ApplicantFields {
  name: string
  phone: string
  email: string
  kind: ApplicantKind
  notes: string
  mentorEmployeeId: number | null
  days: ApplicantDay[]
}

/**
 * The days of a visit („Termine“): at most 30, each a real date with an optional time from and to (to after from: 400
 * visit_day_times_invalid), each date once (visit_day_duplicate); sorted by date.
 */
export function checkApplicantDays(input: unknown): ApplicantDay[] {
  if (!Array.isArray(input)) throw new VisitError('invalid_input')
  if (input.length > VISIT_LIMITS.days) throw new VisitError('visit_days_too_many')
  const days = input.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) throw new VisitError('invalid_input')
    const day = raw as Record<string, unknown>
    const date = optionalDate(day.date, 'visit_day_invalid')
    if (date === null) throw new VisitError('visit_day_invalid')
    const from = minutes(day.from, 'visit_day_times_invalid')
    const to = minutes(day.to, 'visit_day_times_invalid')
    if (from !== null && to !== null && to <= from) throw new VisitError('visit_day_times_invalid')
    return { date, from, to }
  })
  if (new Set(days.map(day => day.date)).size !== days.length) throw new VisitError('visit_day_duplicate')
  return days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** An applicant as stored: a name (visit_name_required), a kind (invalid_input), the checks of the info visit's texts and days. */
export function checkApplicant(input: Record<string, unknown>): ApplicantFields {
  const name = text(input.name, VISIT_LIMITS.name, 'visit_text_too_long')
  if (name === '') throw new VisitError('visit_name_required')
  if (!(APPLICANT_KINDS as readonly unknown[]).includes(input.kind)) throw new VisitError('invalid_input')
  return {
    name,
    phone: text(input.phone, VISIT_LIMITS.phone, 'visit_text_too_long'),
    email: email(input.email),
    kind: input.kind as ApplicantKind,
    notes: text(input.notes ?? '', VISIT_LIMITS.notes, 'notes_too_long'),
    mentorEmployeeId: optionalId(input.mentorEmployeeId),
    days: checkApplicantDays(input.days ?? []),
  }
}

/** An info visit not taken over may be deleted this many months after the visit day (the Träger's setting, default 12). */
export const infoVisitDeletableFrom = (visitDate: IsoDate, months: number): IsoDate => addMonths(visitDate, months)

/**
 * A declined applicant may be deleted this many months after the refusal (default 6: the two months of § 15 Abs. 4 AGG
 * plus the three of § 61b ArbGG and the time a complaint takes to arrive).
 */
export const applicantDeletableFrom = (declinedAt: IsoDate, months: number): IsoDate => addMonths(declinedAt, months)

/**
 * The last activity of an open applicant: the latest of the last change (documents and forms count as changes) and the
 * last day of the visit.
 */
export function applicantLastActivity(updatedAt: string, days: readonly IsoDate[]): IsoDate {
  return [updatedAt.slice(0, 10), ...days].reduce((latest, day) => (day > latest ? day : latest))
}
