import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { checkAnswers, type FormAnswers, type FormContent } from '../../shared/domain/forms'
import { isManager } from '../../shared/domain/roles'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type {
  SessionUser, TeamMeetingDto, TeamMeetingHeader, TeamMeetingInput, TeamMeetingListItemDto, TeamMeetingSavedDto,
  TeamMeetingSaveInput, TeamMeetingsDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, forms, groups, teamMeetings } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { actorName, listTemplates, loadTemplate, withFormErrors } from './formTemplates'

export const TEAM_MEETING_LIMITS = { participants: 300, recorder: 80, reason: 200 } as const

/** The name kept with a change made at the facility's tablet. */
export const TABLET_NAME = 'Tablet'

/**
 * Someone of the facility's team: Leitung/Träger in their (active) facility, a Mitarbeiter account whose employee
 * belongs to it, or the facility's tablet. `name` is kept with their changes; `manager` releases, reopens and deletes;
 * `left`: a Mitarbeiter whose employee has left (before today) still reads but no longer writes.
 */
export interface TeamMember {
  facilityId: number
  name: string
  manager: boolean
  left: boolean
}

/**
 * The signed-in user as a member of the facility they work in (`user.facilityId`, resolved fresh per request: the
 * Träger's active one, a Mitarbeiter's that of the linked employee, the tablet's own): 403 no_facility without one,
 * 403 forbidden for any other kind of account.
 */
export function teamMember(db: Db, user: SessionUser, now: Date = new Date()): TeamMember {
  const facilityId = user.facilityId
  if (facilityId === null) throw new ServiceError(403, 'no_facility')
  if (user.role === 'terminal') return { facilityId, name: TABLET_NAME, manager: false, left: false }
  if (isManager(user.role)) return { facilityId, name: actorName(db, user), manager: true, left: false }
  // A Mitarbeiter account belongs to the facility of its employee (an account without one has no facility).
  if (user.role === 'observer' && user.employeeId !== null) {
    const leftOn = db.select({ leftOn: employees.leftOn }).from(employees).where(eq(employees.id, user.employeeId)).get()?.leftOn
    const left = leftOn !== null && leftOn !== undefined && leftOn < nowInBerlin(now).date
    return { facilityId, name: actorName(db, user), manager: false, left }
  }
  throw new ServiceError(403, 'forbidden')
}

/** 409 employee_inactive: a Mitarbeiter who has left no longer writes the minutes. */
function assertMayWrite(member: TeamMember): void {
  if (member.left) throw new ServiceError(409, 'employee_inactive')
}

type MeetingRow = typeof teamMeetings.$inferSelect
type FormRow = typeof forms.$inferSelect

/** A meeting of the member's facility with its form; another facility's meeting is 404 team_meeting_not_found. */
function loadMeeting(db: Db, member: TeamMember, id: number): { meeting: MeetingRow; form: FormRow } {
  const row = db.select({ meeting: teamMeetings, form: forms }).from(teamMeetings)
    .innerJoin(forms, eq(forms.id, teamMeetings.formId))
    .where(and(eq(teamMeetings.id, id), eq(teamMeetings.facilityId, member.facilityId))).get()
  if (!row) throw new ServiceError(404, 'team_meeting_not_found')
  return row
}

function groupNames(db: Db, facilityId: number): Map<number, string> {
  return new Map(db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.facilityId, facilityId)).all()
    .map(group => [group.id, group.name]))
}

function toListItem(meeting: MeetingRow, form: FormRow, names: Map<number, string>): TeamMeetingListItemDto {
  return {
    id: meeting.id, templateId: form.templateId, title: form.title, date: meeting.date, start: meeting.start,
    groupId: meeting.groupId, groupName: meeting.groupId === null ? null : names.get(meeting.groupId) ?? null,
    participants: meeting.participants, recorder: meeting.recorder, state: meeting.state,
    releasedAt: meeting.releasedAt, releasedBy: meeting.releasedBy,
    reopenReason: meeting.reopenReason, reopenedAt: meeting.reopenedAt, reopenedBy: meeting.reopenedBy,
    createdAt: meeting.createdAt, createdBy: meeting.createdBy, updatedAt: form.updatedAt, updatedBy: form.updatedBy,
  }
}

/** The list filter: every meeting, only those of the whole facility (`'facility'`), or those of one group. */
export type TeamMeetingGroupFilter = 'all' | 'facility' | number

/**
 * The facility's meetings of the year (default: the current one in Berlin), newest first (by date, then time), drafts
 * and released; with the active team templates and the facility's groups to choose from.
 */
export function listTeamMeetings(
  db: Db, member: TeamMember, filter: { year?: number; group?: TeamMeetingGroupFilter } = {}, now: Date = new Date(),
): TeamMeetingsDto {
  const year = filter.year ?? Number(nowInBerlin(now).date.slice(0, 4))
  const group = filter.group ?? 'all'
  const rows = db.select({ meeting: teamMeetings, form: forms }).from(teamMeetings)
    .innerJoin(forms, eq(forms.id, teamMeetings.formId))
    .where(and(
      eq(teamMeetings.facilityId, member.facilityId),
      gte(teamMeetings.date, `${year}-01-01`), lte(teamMeetings.date, `${year}-12-31`),
      group === 'all' ? undefined : group === 'facility' ? isNull(teamMeetings.groupId) : eq(teamMeetings.groupId, group),
    ))
    .orderBy(desc(teamMeetings.date), desc(teamMeetings.start), desc(teamMeetings.id)).all()
  const names = groupNames(db, member.facilityId)
  return {
    meetings: rows.map(row => toListItem(row.meeting, row.form, names)),
    templates: listTemplates(db, member.facilityId, 'team').filter(template => !template.archived)
      .map(template => ({ id: template.id, name: template.name })),
    groups: facilityGroups(db, member.facilityId),
    canManage: member.manager,
  }
}

/** The facility's groups to choose from, in their order. */
function facilityGroups(db: Db, facilityId: number): { id: number; name: string }[] {
  return db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.facilityId, facilityId))
    .orderBy(asc(groups.sortOrder), asc(groups.id)).all()
}

/** One meeting with its content and answers and the groups to choose from (every member, in any state). */
export function getTeamMeeting(db: Db, member: TeamMember, id: number): TeamMeetingDto {
  const { meeting, form } = loadMeeting(db, member, id)
  const facilityName = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, member.facilityId))
    .get()?.name ?? ''
  return {
    ...toListItem(meeting, form, groupNames(db, member.facilityId)),
    content: JSON.parse(form.content) as FormContent,
    answers: JSON.parse(form.answers) as FormAnswers,
    facilityName,
    groups: facilityGroups(db, member.facilityId),
    canManage: member.manager,
  }
}

/**
 * A valid ISO date, a start of 0–1439 minutes or none, a group of the facility or none (404 group_not_found), the
 * participants (≤ 300) and the Protokollführung (≤ 80) trimmed.
 */
function checkedHeader(db: Db, member: TeamMember, input: TeamMeetingHeader): TeamMeetingHeader {
  if (typeof input.date !== 'string' || !isValidIsoDate(input.date)) throw new ServiceError(400, 'team_meeting_date_invalid')
  if (input.start !== null && (!Number.isInteger(input.start) || input.start < 0 || input.start > 1439)) {
    throw new ServiceError(400, 'team_meeting_start_invalid')
  }
  const participants = input.participants.trim()
  if (participants.length > TEAM_MEETING_LIMITS.participants) throw new ServiceError(400, 'team_meeting_participants_too_long')
  const recorder = input.recorder.trim()
  if (recorder.length > TEAM_MEETING_LIMITS.recorder) throw new ServiceError(400, 'team_meeting_recorder_too_long')
  if (input.groupId !== null) {
    const group = db.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.id, input.groupId), eq(groups.facilityId, member.facilityId))).get()
    if (!group) throw new ServiceError(404, 'group_not_found')
  }
  return { date: input.date, start: input.start, groupId: input.groupId, participants, recorder }
}

/** A new draft meeting from an active team template of the facility (its content copied, titled like it); returns its id. */
export function createTeamMeeting(db: Db, member: TeamMember, input: TeamMeetingInput, now: Date = new Date()): number {
  assertMayWrite(member)
  const header = checkedHeader(db, member, input)
  const template = loadTemplate(db, member.facilityId, input.templateId)
  if (template.kind !== 'team') throw new ServiceError(404, 'form_template_not_found')
  if (template.archived) throw new ServiceError(409, 'form_template_archived')
  const at = now.toISOString()
  return db.transaction((tx) => {
    const formId = tx.insert(forms).values({
      facilityId: member.facilityId, templateId: template.id, kind: 'team', title: template.name, content: template.content,
      answers: '{}', createdAt: at, updatedAt: at, updatedBy: member.name,
    }).returning({ id: forms.id }).get().id
    return tx.insert(teamMeetings).values({
      facilityId: member.facilityId, formId, ...header, state: 'draft', createdAt: at, createdBy: member.name,
    }).returning({ id: teamMeetings.id }).get().id
  })
}

/**
 * Stores the header and the answers (checked against the meeting's own content) while the meeting is a draft (409
 * team_meeting_released otherwise). `expectedUpdatedAt` is the last change the saver had loaded; when someone saved in
 * between, nothing is written (409 form_changed). Returns the new last change.
 */
export function saveTeamMeeting(
  db: Db, member: TeamMember, id: number, input: TeamMeetingSaveInput, now: Date = new Date(),
): TeamMeetingSavedDto {
  const { meeting, form } = loadMeeting(db, member, id)
  assertMayWrite(member)
  if (meeting.state !== 'draft') throw new ServiceError(409, 'team_meeting_released')
  if (form.updatedAt !== input.expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  const header = checkedHeader(db, member, input)
  const answers = withFormErrors(() => checkAnswers(JSON.parse(form.content) as FormContent, input.answers))
  const updatedAt = now.toISOString()
  db.transaction((tx) => {
    // Only while still a draft: a release in between wins and nothing is written.
    const kept = tx.update(teamMeetings).set(header)
      .where(and(eq(teamMeetings.id, meeting.id), eq(teamMeetings.state, 'draft'))).run()
    if (kept.changes !== 1) throw new ServiceError(409, 'team_meeting_released')
    const saved = tx.update(forms).set({ answers: JSON.stringify(answers), updatedAt, updatedBy: member.name })
      .where(and(eq(forms.id, form.id), eq(forms.updatedAt, input.expectedUpdatedAt))).run()
    if (saved.changes !== 1) throw new ServiceError(409, 'form_changed')
  })
  return { updatedAt, updatedBy: member.name }
}

/** 403 forbidden unless Leitung or Träger. */
function assertManager(member: TeamMember): void {
  if (!member.manager) throw new ServiceError(403, 'forbidden')
}

/** „Freigeben“ (Leitung/Träger): the draft is locked and readable for all; 409 team_meeting_state_invalid unless a draft. */
export function releaseTeamMeeting(db: Db, member: TeamMember, id: number, now: Date = new Date()): TeamMeetingDto {
  assertManager(member)
  const { meeting } = loadMeeting(db, member, id)
  const result = db.update(teamMeetings).set({ state: 'released', releasedAt: now.toISOString(), releasedBy: member.name })
    .where(and(eq(teamMeetings.id, meeting.id), eq(teamMeetings.state, 'draft'))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'team_meeting_state_invalid')
  return getTeamMeeting(db, member, meeting.id)
}

/**
 * „Wieder öffnen“ (Leitung/Träger) with a reason of 1–200 characters (400 team_meeting_reason_invalid): the released
 * meeting is a draft again; the reason stays with it (the last one). 409 team_meeting_state_invalid unless released.
 */
export function reopenTeamMeeting(db: Db, member: TeamMember, id: number, reason: string, now: Date = new Date()): TeamMeetingDto {
  assertManager(member)
  const { meeting } = loadMeeting(db, member, id)
  const text = reason.trim()
  if (text.length === 0 || text.length > TEAM_MEETING_LIMITS.reason) throw new ServiceError(400, 'team_meeting_reason_invalid')
  const result = db.update(teamMeetings).set({
    state: 'draft', releasedAt: null, releasedBy: null, reopenReason: text, reopenedAt: now.toISOString(), reopenedBy: member.name,
  }).where(and(eq(teamMeetings.id, meeting.id), eq(teamMeetings.state, 'released'))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'team_meeting_state_invalid')
  return getTeamMeeting(db, member, meeting.id)
}

/** Deletes a meeting with its minutes (Leitung/Träger, in any state); its form goes and the meeting with it. */
export function deleteTeamMeeting(db: Db, member: TeamMember, id: number): void {
  assertManager(member)
  const { form } = loadMeeting(db, member, id)
  db.delete(forms).where(eq(forms.id, form.id)).run()
}
