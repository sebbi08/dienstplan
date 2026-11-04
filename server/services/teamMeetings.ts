import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { checkAnswers, type FormAnswers, type FormContent } from '../../shared/domain/forms'
import { can } from '../../shared/domain/permissions'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type {
  SessionUser, TeamMeetingDto, TeamMeetingHeader, TeamMeetingInput, TeamMeetingListItemDto, TeamMeetingSavedDto,
  TeamMeetingSaveInput, TeamMeetingSignerDto, TeamMeetingsDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilities, forms, groups, teamMeetingParticipants, teamMeetings } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { actorName, listTemplates, loadTemplate, withFormErrors } from './formTemplates'
import { verifyEmployeePin } from './terminal'

export const TEAM_MEETING_LIMITS = { participants: 300, recorder: 80, reason: 200 } as const

/** The name kept with a change made at the facility's tablet. */
export const TABLET_NAME = 'Tablet'

/**
 * Someone of the facility's team: Leitung/Träger in their (active) facility, a Mitarbeiter account whose employee
 * belongs to it, or the facility's tablet. `name` is kept with their changes; `manager` releases, reopens and deletes;
 * `left`: a Mitarbeiter whose employee has left (before today) still reads but no longer writes; `employeeId`: their own
 * employee (Leitung/Träger: the linked one, if any; null for the tablet), who signs as a participant.
 */
export interface TeamMember {
  facilityId: number
  name: string
  manager: boolean
  left: boolean
  employeeId: number | null
}

/**
 * The signed-in user as a member of the facility they work in (`user.facilityId`, resolved fresh per request: the
 * Träger's active one, a Mitarbeiter's that of the linked employee, the tablet's own): 403 no_facility without one,
 * 403 forbidden for any other kind of account.
 */
export function teamMember(db: Db, user: SessionUser, now: Date = new Date()): TeamMember {
  const facilityId = user.facilityId
  if (facilityId === null) throw new ServiceError(403, 'no_facility')
  if (user.role === 'terminal') return { facilityId, name: TABLET_NAME, manager: false, left: false, employeeId: null }
  if (can(user.permissions, 'teamMeetings.manage')) {
    return { facilityId, name: actorName(db, user), manager: true, left: false, employeeId: user.employeeId }
  }
  // Everyone else who writes the minutes belongs to the facility of their employee (a Mitarbeiter account without one
  // has no facility).
  if (can(user.permissions, 'teamMeetings.write') && user.employeeId !== null) {
    const leftOn = db.select({ leftOn: employees.leftOn }).from(employees).where(eq(employees.id, user.employeeId)).get()?.leftOn
    const left = leftBefore(leftOn, nowInBerlin(now).date)
    return { facilityId, name: actorName(db, user), manager: false, left, employeeId: user.employeeId }
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

/** Whether an employee who leaves on `leftOn` has left before `today` (on the leaving day itself not yet). */
const leftBefore = (leftOn: string | null | undefined, today: string): boolean =>
  leftOn !== null && leftOn !== undefined && leftOn < today

/** The employee has not left before `today` (the SQL form of !leftBefore). */
const notLeftBefore = (today: string) => or(isNull(employees.leftOn), gte(employees.leftOn, today))

/**
 * The chosen participants of each of the meetings, in their order (one query for all); `left` for those whose
 * employee left before `today` (the same rule as signing's employee_inactive).
 */
function signersOf(db: Db, meetingIds: number[], today: string): Map<number, TeamMeetingSignerDto[]> {
  const byMeeting = new Map(meetingIds.map(id => [id, [] as TeamMeetingSignerDto[]]))
  if (meetingIds.length === 0) return byMeeting
  const rows = db.select({ participant: teamMeetingParticipants, leftOn: employees.leftOn }).from(teamMeetingParticipants)
    .leftJoin(employees, eq(employees.id, teamMeetingParticipants.employeeId))
    .where(inArray(teamMeetingParticipants.meetingId, meetingIds))
    .orderBy(asc(teamMeetingParticipants.sortOrder), asc(teamMeetingParticipants.id)).all()
  for (const { participant: row, leftOn } of rows) {
    byMeeting.get(row.meetingId)!.push({
      employeeId: row.employeeId, name: row.name, signedAt: row.signedAt, signedVia: row.signedVia, left: leftBefore(leftOn, today),
    })
  }
  return byMeeting
}

/**
 * The facility's employees to choose as participants, in the staff list's order: those not left before `today`, and
 * `chosen` (already participants of the meeting) even if they left.
 */
function choosableStaff(db: Db, facilityId: number, today: string, chosen: number[] = []): TeamMeetingsDto['staff'] {
  return db.select({ id: employees.id, name: employees.name, shortName: employees.shortName }).from(employees)
    .where(and(
      eq(employees.facilityId, facilityId),
      or(notLeftBefore(today), chosen.length > 0 ? inArray(employees.id, chosen) : undefined),
    ))
    .orderBy(asc(employees.sortOrder), asc(employees.name)).all()
}

/**
 * The released meetings of the facility (any year) in which the member's own employee is a participant who has not
 * signed yet, with the oldest by date; none at the tablet, for a member without an employee, or once that employee
 * left before `today` (they can no longer sign; a Träger linked to them still signs in).
 */
function toSign(db: Db, member: TeamMember, today: string): TeamMeetingsDto['toSign'] {
  if (member.employeeId === null) return { count: 0, firstId: null }
  const rows = db.select({ id: teamMeetings.id }).from(teamMeetingParticipants)
    .innerJoin(teamMeetings, eq(teamMeetings.id, teamMeetingParticipants.meetingId))
    .innerJoin(employees, eq(employees.id, teamMeetingParticipants.employeeId))
    .where(and(
      eq(teamMeetings.facilityId, member.facilityId), eq(teamMeetings.state, 'released'),
      eq(teamMeetingParticipants.employeeId, member.employeeId), isNull(teamMeetingParticipants.signedAt),
      notLeftBefore(today),
    ))
    .orderBy(asc(teamMeetings.date), asc(teamMeetings.start), asc(teamMeetings.id)).all()
  return { count: rows.length, firstId: rows[0]?.id ?? null }
}

function toListItem(
  meeting: MeetingRow, form: FormRow, names: Map<number, string>, signers: TeamMeetingSignerDto[], member: TeamMember,
): TeamMeetingListItemDto {
  const mineOpen = meeting.state === 'released' && member.employeeId !== null
    && signers.some(signer => signer.employeeId === member.employeeId && signer.signedAt === null && !signer.left)
  return {
    id: meeting.id, templateId: form.templateId, title: form.title, date: meeting.date, start: meeting.start,
    groupId: meeting.groupId, groupName: meeting.groupId === null ? null : names.get(meeting.groupId) ?? null,
    participants: meeting.participants, signers, mineOpen, recorder: meeting.recorder, state: meeting.state,
    releasedAt: meeting.releasedAt, releasedBy: meeting.releasedBy,
    reopenReason: meeting.reopenReason, reopenedAt: meeting.reopenedAt, reopenedBy: meeting.reopenedBy,
    createdAt: meeting.createdAt, createdBy: meeting.createdBy, updatedAt: form.updatedAt, updatedBy: form.updatedBy,
  }
}

/** The list filter: every meeting, only those of the whole facility (`'facility'`), or those of one group. */
export type TeamMeetingGroupFilter = 'all' | 'facility' | number

/**
 * The facility's meetings of the year (default: the current one in Berlin), newest first (by date, then time), drafts
 * and released, with their participants; with the active team templates, the facility's groups and staff to choose
 * from, and the minutes the member still has to sign.
 */
export function listTeamMeetings(
  db: Db, member: TeamMember, filter: { year?: number; group?: TeamMeetingGroupFilter } = {}, now: Date = new Date(),
): TeamMeetingsDto {
  const today = nowInBerlin(now).date
  const year = filter.year ?? Number(today.slice(0, 4))
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
  const signers = signersOf(db, rows.map(row => row.meeting.id), today)
  return {
    meetings: rows.map(row => toListItem(row.meeting, row.form, names, signers.get(row.meeting.id)!, member)),
    templates: listTemplates(db, member.facilityId, 'team').filter(template => !template.archived)
      .map(template => ({ id: template.id, name: template.name })),
    groups: facilityGroups(db, member.facilityId),
    staff: choosableStaff(db, member.facilityId, today),
    toSign: toSign(db, member, today),
    canManage: member.manager,
  }
}

/** The facility's groups to choose from, in their order. */
function facilityGroups(db: Db, facilityId: number): { id: number; name: string }[] {
  return db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.facilityId, facilityId))
    .orderBy(asc(groups.sortOrder), asc(groups.id)).all()
}

/**
 * One meeting with its content, answers and participants, and the groups and staff to choose from (every member, in
 * any state).
 */
export function getTeamMeeting(db: Db, member: TeamMember, id: number, now: Date = new Date()): TeamMeetingDto {
  const { meeting, form } = loadMeeting(db, member, id)
  const facilityName = db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, member.facilityId))
    .get()?.name ?? ''
  const today = nowInBerlin(now).date
  const signers = signersOf(db, [meeting.id], today).get(meeting.id)!
  const chosen = signers.flatMap(signer => (signer.employeeId === null ? [] : [signer.employeeId]))
  return {
    ...toListItem(meeting, form, groupNames(db, member.facilityId), signers, member),
    content: JSON.parse(form.content) as FormContent,
    answers: JSON.parse(form.answers) as FormAnswers,
    facilityName,
    groups: facilityGroups(db, member.facilityId),
    staff: choosableStaff(db, member.facilityId, today, chosen),
    canManage: member.manager,
  }
}

/** A checked header: the columns of the meeting, and the chosen employees in their order with their current name. */
interface CheckedHeader {
  columns: Omit<TeamMeetingHeader, 'participantIds'>
  participants: { id: number; name: string }[]
}

/**
 * A valid ISO date, a start of 0–1439 minutes or none, a group of the facility or none (404 group_not_found), the
 * further participants (≤ 300) and the Protokollführung (≤ 80) trimmed; the chosen participants once each, employees
 * of the facility (404 employee_not_found) who have not left before today (409 employee_inactive) unless `chosen`
 * already (participants of the meeting).
 */
function checkedHeader(
  db: Db, member: TeamMember, input: TeamMeetingHeader, now: Date, chosen: ReadonlySet<number> = new Set(),
): CheckedHeader {
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
  const ids = [...new Set(input.participantIds)]
  const found = ids.length === 0
    ? []
    : db.select({ id: employees.id, name: employees.name, leftOn: employees.leftOn }).from(employees)
        .where(and(inArray(employees.id, ids), eq(employees.facilityId, member.facilityId))).all()
  if (found.length !== ids.length) throw new ServiceError(404, 'employee_not_found')
  const today = nowInBerlin(now).date
  if (found.some(employee => !chosen.has(employee.id) && employee.leftOn !== null && employee.leftOn < today)) {
    throw new ServiceError(409, 'employee_inactive')
  }
  const names = new Map(found.map(employee => [employee.id, employee.name]))
  return {
    columns: { date: input.date, start: input.start, groupId: input.groupId, participants, recorder },
    participants: ids.map(id => ({ id, name: names.get(id)! })),
  }
}

/**
 * Makes the meeting's chosen employees exactly `participants`, in that order: the others go, new ones are stored with
 * their current name, those who stay keep their stored name and signature. Those deleted for good (no employee any
 * more, so the client cannot send them again) stay, after the chosen ones in their previous order.
 */
function writeParticipants(tx: Db, meetingId: number, participants: CheckedHeader['participants']): void {
  const ids = participants.map(participant => participant.id)
  tx.delete(teamMeetingParticipants).where(and(
    eq(teamMeetingParticipants.meetingId, meetingId),
    ids.length === 0 ? isNotNull(teamMeetingParticipants.employeeId) : notInArray(teamMeetingParticipants.employeeId, ids),
  )).run()
  participants.forEach(({ id, name }, sortOrder) => {
    tx.insert(teamMeetingParticipants).values({ meetingId, employeeId: id, name, sortOrder })
      .onConflictDoUpdate({ target: [teamMeetingParticipants.meetingId, teamMeetingParticipants.employeeId], set: { sortOrder } }).run()
  })
  const deleted = tx.select({ id: teamMeetingParticipants.id }).from(teamMeetingParticipants)
    .where(and(eq(teamMeetingParticipants.meetingId, meetingId), isNull(teamMeetingParticipants.employeeId)))
    .orderBy(asc(teamMeetingParticipants.sortOrder), asc(teamMeetingParticipants.id)).all()
  deleted.forEach(({ id }, index) => {
    tx.update(teamMeetingParticipants).set({ sortOrder: ids.length + index }).where(eq(teamMeetingParticipants.id, id)).run()
  })
}

/** The employees already chosen as participants of the meeting. */
function participantIdsOf(db: Db, meetingId: number): Set<number> {
  return new Set(db.select({ employeeId: teamMeetingParticipants.employeeId }).from(teamMeetingParticipants)
    .where(eq(teamMeetingParticipants.meetingId, meetingId)).all()
    .flatMap(row => (row.employeeId === null ? [] : [row.employeeId])))
}

/**
 * A new draft meeting from an active team template of the facility (its content copied, titled like it) with its chosen
 * participants; returns its id.
 */
export function createTeamMeeting(db: Db, member: TeamMember, input: TeamMeetingInput, now: Date = new Date()): number {
  assertMayWrite(member)
  const header = checkedHeader(db, member, input, now)
  const template = loadTemplate(db, member.facilityId, input.templateId)
  if (template.kind !== 'team') throw new ServiceError(404, 'form_template_not_found')
  if (template.archived) throw new ServiceError(409, 'form_template_archived')
  const at = now.toISOString()
  return db.transaction((tx) => {
    const formId = tx.insert(forms).values({
      facilityId: member.facilityId, templateId: template.id, kind: 'team', title: template.name, content: template.content,
      answers: '{}', createdAt: at, updatedAt: at, updatedBy: member.name,
    }).returning({ id: forms.id }).get().id
    const meetingId = tx.insert(teamMeetings).values({
      facilityId: member.facilityId, formId, ...header.columns, state: 'draft', createdAt: at, createdBy: member.name,
    }).returning({ id: teamMeetings.id }).get().id
    writeParticipants(tx, meetingId, header.participants)
    return meetingId
  })
}

/**
 * Stores the header with the chosen participants and the answers (checked against the meeting's own content) while the
 * meeting is a draft (409 team_meeting_released otherwise). `expectedUpdatedAt` is the last change the saver had
 * loaded; when someone saved in between, nothing is written (409 form_changed). Returns the new last change.
 */
export function saveTeamMeeting(
  db: Db, member: TeamMember, id: number, input: TeamMeetingSaveInput, now: Date = new Date(),
): TeamMeetingSavedDto {
  const { meeting, form } = loadMeeting(db, member, id)
  assertMayWrite(member)
  if (meeting.state !== 'draft') throw new ServiceError(409, 'team_meeting_released')
  if (form.updatedAt !== input.expectedUpdatedAt) throw new ServiceError(409, 'form_changed')
  const header = checkedHeader(db, member, input, now, participantIdsOf(db, meeting.id))
  const answers = withFormErrors(() => checkAnswers(JSON.parse(form.content) as FormContent, input.answers))
  const updatedAt = now.toISOString()
  db.transaction((tx) => {
    // Only while still a draft: a release in between wins and nothing is written.
    const kept = tx.update(teamMeetings).set(header.columns)
      .where(and(eq(teamMeetings.id, meeting.id), eq(teamMeetings.state, 'draft'))).run()
    if (kept.changes !== 1) throw new ServiceError(409, 'team_meeting_released')
    writeParticipants(tx, meeting.id, header.participants)
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
  return getTeamMeeting(db, member, meeting.id, now)
}

/**
 * „Wieder öffnen“ (Leitung/Träger) with a reason of 1–200 characters (400 team_meeting_reason_invalid): the released
 * meeting is a draft again; the reason stays with it (the last one). Every signature goes, the participants stay: after
 * the new release all sign again. 409 team_meeting_state_invalid unless released.
 */
export function reopenTeamMeeting(db: Db, member: TeamMember, id: number, reason: string, now: Date = new Date()): TeamMeetingDto {
  assertManager(member)
  const { meeting } = loadMeeting(db, member, id)
  const text = reason.trim()
  if (text.length === 0 || text.length > TEAM_MEETING_LIMITS.reason) throw new ServiceError(400, 'team_meeting_reason_invalid')
  db.transaction((tx) => {
    const result = tx.update(teamMeetings).set({
      state: 'draft', releasedAt: null, releasedBy: null, reopenReason: text, reopenedAt: now.toISOString(), reopenedBy: member.name,
    }).where(and(eq(teamMeetings.id, meeting.id), eq(teamMeetings.state, 'released'))).run()
    if (result.changes !== 1) throw new ServiceError(409, 'team_meeting_state_invalid')
    tx.update(teamMeetingParticipants).set({ signedAt: null, signedVia: null })
      .where(eq(teamMeetingParticipants.meetingId, meeting.id)).run()
  })
  return getTeamMeeting(db, member, meeting.id, now)
}

/**
 * „Gelesen und unterzeichnen“: a participant signs the released minutes (409 team_meeting_not_released before), once
 * (409 team_meeting_already_signed), unless they left before today (409 employee_inactive). An account signs for its
 * own employee only (any `input` is ignored; 403 team_meeting_not_participant without one or when not chosen). The
 * tablet signs for the chosen `employeeId` with that person's `pin` (400 team_meeting_sign_input_invalid without both):
 * a person not of the facility is 404 employee_not_found and one not chosen 403, before the PIN is looked at, so no
 * attempt is counted; the PIN then counts towards the same lock as stamping (pin_missing, pin_invalid, the lock codes).
 */
export function signTeamMeeting(
  db: Db, member: TeamMember, id: number, input: { employeeId?: number; pin?: string }, now: Date = new Date(),
): TeamMeetingDto {
  const { meeting } = loadMeeting(db, member, id)
  if (meeting.state !== 'released') throw new ServiceError(409, 'team_meeting_not_released')
  // Only the tablet has neither an own employee nor the right to manage (a Mitarbeiter account always has an employee).
  const atTablet = member.employeeId === null && !member.manager
  let employeeId: number
  if (atTablet) {
    if (input.employeeId === undefined || !input.pin) throw new ServiceError(400, 'team_meeting_sign_input_invalid')
    employeeId = input.employeeId
    const employee = db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.facilityId, member.facilityId))).get()
    if (!employee) throw new ServiceError(404, 'employee_not_found')
  }
  else {
    if (member.employeeId === null) throw new ServiceError(403, 'team_meeting_not_participant')
    employeeId = member.employeeId
  }
  const row = db.select({ id: teamMeetingParticipants.id, signedAt: teamMeetingParticipants.signedAt, leftOn: employees.leftOn })
    .from(teamMeetingParticipants)
    .innerJoin(employees, eq(employees.id, teamMeetingParticipants.employeeId))
    .where(and(eq(teamMeetingParticipants.meetingId, meeting.id), eq(teamMeetingParticipants.employeeId, employeeId))).get()
  if (!row) throw new ServiceError(403, 'team_meeting_not_participant')
  if (row.signedAt !== null) throw new ServiceError(409, 'team_meeting_already_signed')
  if (leftBefore(row.leftOn, nowInBerlin(now).date)) throw new ServiceError(409, 'employee_inactive')
  if (atTablet) verifyEmployeePin(db, employeeId, input.pin!, now)
  // Only while unsigned: of two signatures at once, the first one stays.
  const result = db.update(teamMeetingParticipants).set({ signedAt: now.toISOString(), signedVia: atTablet ? 'tablet' : 'account' })
    .where(and(eq(teamMeetingParticipants.id, row.id), isNull(teamMeetingParticipants.signedAt))).run()
  if (result.changes !== 1) throw new ServiceError(409, 'team_meeting_already_signed')
  return getTeamMeeting(db, member, meeting.id, now)
}

/** Deletes a meeting with its minutes (Leitung/Träger, in any state); its form goes and the meeting with it. */
export function deleteTeamMeeting(db: Db, member: TeamMember, id: number): void {
  assertManager(member)
  const { form } = loadMeeting(db, member, id)
  db.delete(forms).where(eq(forms.id, form.id)).run()
}
