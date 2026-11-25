import { matchesSearch } from '#shared/domain/search'
import { formatTime, parseTime } from '#shared/domain/time'
import type {
  ApplicantDayDto, ApplicantVisitDto, ApplicantVisitInput, ApplicantVisitListItemDto, InfoVisitDto, InfoVisitInput,
  InfoVisitListItemDto,
} from '#shared/types/api'
import { formatDate } from '~/utils/format'

/**
 * „Infogespräche“ (Kinder → Planung) and „Bewerbungen & Hospitationen“ (Mitarbeiter): the list filters and the form
 * values of the detail pages (server/services/visits.ts).
 */

/** The status filter's value for every status. */
export const ALL_STATUSES = 'all'

/** The info visits matching the search (family, child, guide) and the status filter. */
export function filterInfoVisits(items: readonly InfoVisitListItemDto[], query: string, status: string): InfoVisitListItemDto[] {
  return items.filter(item => (status === ALL_STATUSES || item.status === status)
    && matchesSearch([item.familyName, item.childFirstName, item.childLastName, item.guidedBy, item.email, item.phone], query))
}

/** The applicants matching the search (name, mentor, contact) and the status filter. */
export function filterApplicants(items: readonly ApplicantVisitListItemDto[], query: string, status: string): ApplicantVisitListItemDto[] {
  return items.filter(item => (status === ALL_STATUSES || item.status === status)
    && matchesSearch([item.name, item.mentorName ?? '', item.email, item.phone], query))
}

/** A time of the form as text („10:00“, '' for none). */
export const visitTimeText = (minutes: number | null): string => (minutes === null ? '' : formatTime(minutes))
/** The minutes of a typed time (null for an empty or unreadable one). */
export const visitTimeValue = (text: string): number | null => (text.trim() === '' ? null : parseTime(text))

/** The days of an applicant as one line („01.12.2026 – 05.12.2026“, a single day alone, '' without days). */
export function dayRangeText(item: Pick<ApplicantVisitListItemDto, 'firstDay' | 'lastDay'>): string {
  if (item.firstDay === null) return ''
  return item.lastDay && item.lastDay !== item.firstDay ? `${formatDate(item.firstDay)} – ${formatDate(item.lastDay)}` : formatDate(item.firstDay)
}

/** The editable fields of an info visit as the detail form holds them (dates '' for none, times as text). */
export interface InfoVisitForm {
  visitDate: string; visitStart: string; familyName: string; phone: string; email: string; childFirstName: string
  childLastName: string; childBirthDate: string; desiredStart: string; guidedByEmployeeId: number | null; guidedByName: string; notes: string
}

export const emptyInfoVisitForm = (today: string): InfoVisitForm => ({
  visitDate: today, visitStart: '', familyName: '', phone: '', email: '', childFirstName: '', childLastName: '', childBirthDate: '',
  desiredStart: '', guidedByEmployeeId: null, guidedByName: '', notes: '',
})

export function infoVisitForm(visit: InfoVisitDto): InfoVisitForm {
  return {
    visitDate: visit.visitDate, visitStart: visitTimeText(visit.visitStart), familyName: visit.familyName, phone: visit.phone, email: visit.email,
    childFirstName: visit.childFirstName, childLastName: visit.childLastName, childBirthDate: visit.childBirthDate ?? '',
    desiredStart: visit.desiredStart ?? '', guidedByEmployeeId: visit.guidedByEmployeeId, guidedByName: visit.guidedByName, notes: visit.notes,
  }
}

export function infoVisitBody(form: InfoVisitForm, status?: 'open' | 'declined'): InfoVisitInput {
  return {
    ...form, visitStart: visitTimeValue(form.visitStart), childBirthDate: form.childBirthDate || null, desiredStart: form.desiredStart || null,
    ...(status ? { status } : {}),
  }
}

/** A day of the applicant's form, the times as text. */
export interface ApplicantDayForm { date: string; from: string; to: string }

export interface ApplicantForm {
  name: string; phone: string; email: string; kind: ApplicantVisitInput['kind']; notes: string; mentorEmployeeId: number | null; days: ApplicantDayForm[]
}

export const emptyApplicantForm = (): ApplicantForm => ({
  name: '', phone: '', email: '', kind: 'hospitation', notes: '', mentorEmployeeId: null, days: [],
})

export function applicantForm(visit: ApplicantVisitDto): ApplicantForm {
  return {
    name: visit.name, phone: visit.phone, email: visit.email, kind: visit.kind, notes: visit.notes, mentorEmployeeId: visit.mentorEmployeeId,
    days: visit.days.map(day => ({ date: day.date, from: visitTimeText(day.from), to: visitTimeText(day.to) })),
  }
}

export function applicantBody(form: ApplicantForm, status?: 'open' | 'declined'): ApplicantVisitInput {
  const days: ApplicantDayDto[] = form.days.map(day => ({ date: day.date, from: visitTimeValue(day.from), to: visitTimeValue(day.to) }))
  return { ...form, days, ...(status ? { status } : {}) }
}
