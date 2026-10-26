import { isValidIsoDate } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { TeamMeetingHeader, TeamMeetingListItemDto } from '#shared/types/api'
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

/** The header fields as typed: the time as text, the group as the select's value ('facility' or the group's id). */
export interface TeamMeetingHeaderForm {
  date: string
  start: string
  group: string
  participants: string
  recorder: string
}

export const FACILITY_GROUP = 'facility'

/** The fields of a stored meeting, or empty ones for a new meeting on `date`. */
export function headerForm(meeting: Pick<TeamMeetingListItemDto, 'date' | 'start' | 'groupId' | 'participants' | 'recorder'> | null, date = ''): TeamMeetingHeaderForm {
  if (!meeting) return { date, start: '', group: FACILITY_GROUP, participants: '', recorder: '' }
  return {
    date: meeting.date,
    start: meeting.start === null ? '' : formatTime(meeting.start),
    group: meeting.groupId === null ? FACILITY_GROUP : String(meeting.groupId),
    participants: meeting.participants,
    recorder: meeting.recorder,
  }
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
  }
}
