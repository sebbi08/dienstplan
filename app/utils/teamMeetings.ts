import { isValidIsoDate } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { TeamMeetingHeader, TeamMeetingListItemDto, TeamMeetingSignerDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** The group filter of the list: every meeting, only those of the whole facility, or one group's. */
export type TeamMeetingFilter = 'all' | 'facility' | number

/** The list route's `groupId`: none for „Alle“, 0 for „Einrichtung“, else the group's id. */
export const filterGroupId = (filter: TeamMeetingFilter): number | undefined =>
  filter === 'all' ? undefined : filter === 'facility' ? 0 : filter

/** The filter from the page's query (`?group=facility` / `?group=4`); anything else is „Alle“. */
export function filterFromQuery(value: unknown): TeamMeetingFilter {
  if (value === 'facility') return 'facility'
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isInteger(id) && id > 0 ? id : 'all'
}

/**
 * The header fields as typed: the time as text, the group as the select's value ('facility' or the group's id);
 * `participantIds` the employees ticked as participants, `participants` the further ones typed in.
 */
export interface TeamMeetingHeaderForm {
  date: string
  start: string
  group: string
  participants: string
  recorder: string
  participantIds: number[]
}

export const FACILITY_GROUP = 'facility'

/**
 * The fields of a stored meeting, or empty ones for a new meeting on `date`. The ticked participants are the stored
 * ones that are still employees (one deleted for good cannot be ticked again; the server keeps them).
 */
export function headerForm(
  meeting: Pick<TeamMeetingListItemDto, 'date' | 'start' | 'groupId' | 'participants' | 'recorder' | 'signers'> | null,
  date = '',
): TeamMeetingHeaderForm {
  if (!meeting) return { date, start: '', group: FACILITY_GROUP, participants: '', recorder: '', participantIds: [] }
  return {
    date: meeting.date,
    start: meeting.start === null ? '' : formatTime(meeting.start),
    group: meeting.groupId === null ? FACILITY_GROUP : String(meeting.groupId),
    participants: meeting.participants,
    recorder: meeting.recorder,
    participantIds: meeting.signers.flatMap(signer => (signer.employeeId === null ? [] : [signer.employeeId])),
  }
}

/**
 * The ticked participants after (un)ticking `id`, in the order of the staff list shown (any not in that list keep
 * their place after them).
 */
export function toggleParticipant(ids: number[], staff: { id: number }[], id: number, on: boolean): number[] {
  const picked = new Set(ids)
  if (on) picked.add(id)
  else picked.delete(id)
  const shown = staff.map(person => person.id)
  return [...shown.filter(staffId => picked.has(staffId)), ...ids.filter(other => picked.has(other) && !shown.includes(other))]
}

/** The header's „Teilnehmer“ in one line: the participants chosen from the staff, then the ones typed in. */
export function participantsLine(names: string[], typed: string): string {
  return [...names, typed.trim()].filter(Boolean).join(', ')
}

/**
 * Whether a participant counts for „N von M unterzeichnet“: everyone who signed and everyone who still can. One whose
 * employee was deleted for good before signing never can, so they are only named.
 */
export const countsAsSigner = (signer: Pick<TeamMeetingSignerDto, 'employeeId' | 'signedAt'>): boolean =>
  signer.signedAt !== null || signer.employeeId !== null

/** „N von M unterzeichnet“ over the participants who count (see countsAsSigner). */
export function signingProgress(signers: Pick<TeamMeetingSignerDto, 'employeeId' | 'signedAt'>[]): { signed: number; total: number } {
  const counted = signers.filter(countsAsSigner)
  return { signed: counted.filter(signer => signer.signedAt !== null).length, total: counted.length }
}

/** A valid date and, if given, a valid time; else the message to show instead of saving. */
export function checkHeader(form: TeamMeetingHeaderForm): string | null {
  if (!isValidIsoDate(form.date)) return de.teamMeetings.dateInvalid
  const start = form.start.trim()
  if (start && (parseTime(start) === null || parseTime(start)! > 1439)) return de.common.invalidTimeAnyMinute
  return null
}

/** What the routes take: no time typed is none; the group 'facility' is none (the whole facility). */
export function headerBody(form: TeamMeetingHeaderForm): TeamMeetingHeader {
  const start = form.start.trim()
  return {
    date: form.date,
    // An unreadable time goes to the server as -1, so it answers with its German text.
    start: start ? (parseTime(start) ?? -1) : null,
    groupId: form.group === FACILITY_GROUP ? null : Number(form.group),
    participants: form.participants,
    recorder: form.recorder,
    participantIds: form.participantIds,
  }
}
