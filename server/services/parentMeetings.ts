import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate, Minutes } from '../../shared/domain/types'
import {
  MEETING_KINDS, type MeetingKind, type OverviewMeetingDto, type ParentMeetingDto, type ParentMeetingInput,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { childParentMeetings, children, forms } from '../db/schema'
import { loadEditableChild } from '../lib/childRecord'
import { asChildEditor, type ChildActor, type ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'

type MeetingRow = typeof childParentMeetings.$inferSelect

const MAX_PARTICIPANTS = 200
const MAX_NOTE = 2000

/** Whether a meeting lies ahead at `now`: a later day (Berlin), or today with a start later than the current minute. */
function isPlanned(row: Pick<MeetingRow, 'date' | 'start'>, now: Date): boolean {
  const { date, minutes } = nowInBerlin(now)
  return row.date > date || (row.date === date && row.start > minutes)
}

/** The meeting as the viewer sees it: the confidential note only for Leitung and Träger, for everyone else no field at all. */
function toDto(row: MeetingRow, viewer: Pick<ChildViewer, 'permissions'>, now: Date, formId: number | null): ParentMeetingDto {
  return {
    id: row.id, date: row.date, start: row.start, end: row.end, kind: row.kind, participants: row.participants,
    ...(can(viewer.permissions, 'children.manage') ? { note: row.note } : {}),
    planned: isPlanned(row, now),
    createdByName: row.createdByName, createdAt: row.createdAt, updatedByName: row.updatedByName, updatedAt: row.updatedAt,
    formId,
  }
}

/**
 * The child's parent meetings, newest first (by date, then start), each with the observation form filled for it. The
 * caller has checked that the viewer may read the record (see `getChild`); the note goes only to Leitung and Träger.
 */
export function meetingsOf(db: Db, viewer: Pick<ChildViewer, 'permissions'>, childId: number, now: Date = new Date()): ParentMeetingDto[] {
  const rows = db.select().from(childParentMeetings).where(eq(childParentMeetings.childId, childId))
    .orderBy(desc(childParentMeetings.date), desc(childParentMeetings.start), desc(childParentMeetings.id)).all()
  const formOf = new Map(rows.length === 0 ? [] : db.select({ id: forms.id, meetingId: forms.parentMeetingId }).from(forms)
    .where(and(eq(forms.childId, childId), inArray(forms.parentMeetingId, rows.map(row => row.id)))).all()
    .map(form => [form.meetingId!, form.id]))
  return rows.map(row => toDto(row, viewer, now, formOf.get(row.id) ?? null))
}

/**
 * The parent meetings of these children for the overview, newest first per child (as `meetingsOf`), with date, start,
 * kind and planned only: never the participants or the note. The caller passes only children the viewer sees. Every
 * given child has an entry (an empty list without meetings).
 */
export function overviewMeetingsOf(db: Db, childIds: number[], now: Date = new Date()): Map<number, OverviewMeetingDto[]> {
  const byChild = new Map<number, OverviewMeetingDto[]>(childIds.map(id => [id, []]))
  if (childIds.length === 0) return byChild
  const rows = db.select({
    childId: childParentMeetings.childId, date: childParentMeetings.date, start: childParentMeetings.start,
    kind: childParentMeetings.kind,
  }).from(childParentMeetings).where(inArray(childParentMeetings.childId, childIds))
    .orderBy(desc(childParentMeetings.date), desc(childParentMeetings.start), desc(childParentMeetings.id)).all()
  for (const row of rows) {
    byChild.get(row.childId)!.push({ date: row.date, start: row.start, kind: row.kind, planned: isPlanned(row, now) })
  }
  return byChild
}

/** The meetings of these children on `date` (start and kind only), by start. The caller passes only children the viewer sees. */
export function meetingsOnDay(
  db: Db, childIds: number[], date: IsoDate,
): { childId: number; start: Minutes; kind: MeetingKind }[] {
  if (childIds.length === 0) return []
  return db.select({ childId: childParentMeetings.childId, start: childParentMeetings.start, kind: childParentMeetings.kind })
    .from(childParentMeetings)
    .where(and(inArray(childParentMeetings.childId, childIds), eq(childParentMeetings.date, date)))
    .orderBy(asc(childParentMeetings.start), asc(childParentMeetings.id)).all()
}

const isClockTime = (value: number) => Number.isInteger(value) && value >= 0 && value <= 1439

/**
 * The checked values: a valid day (400 invalid_date), a start and an optional end as minutes 0–1439 (400 invalid_time)
 * with the end after the start (400 meeting_end_invalid), a known kind (400 meeting_kind_invalid) and trimmed texts of
 * at most 200 (participants) and 2000 (note) characters (400 meeting_text_too_long). Only Leitung and Träger send a
 * note, an empty one included (403 meeting_note_managers_only); without one the note is `undefined`.
 */
function checkedMeeting(actor: ChildActor, input: ParentMeetingInput): ParentMeetingInput {
  if (input.note !== undefined && !can(actor.permissions, 'children.manage')) throw new ServiceError(403, 'meeting_note_managers_only')
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'invalid_date')
  if (!isClockTime(input.start) || (input.end !== null && !isClockTime(input.end))) throw new ServiceError(400, 'invalid_time')
  if (input.end !== null && input.end <= input.start) throw new ServiceError(400, 'meeting_end_invalid')
  if (!(MEETING_KINDS as readonly string[]).includes(input.kind)) throw new ServiceError(400, 'meeting_kind_invalid')
  const participants = input.participants.trim()
  const note = input.note?.trim()
  if (participants.length > MAX_PARTICIPANTS || (note?.length ?? 0) > MAX_NOTE) {
    throw new ServiceError(400, 'meeting_text_too_long')
  }
  return { date: input.date, start: input.start, end: input.end, kind: input.kind, participants, note }
}

/**
 * The meeting for a change by the actor: it must belong to a child of the actor's facility (404 meeting_not_found), and
 * the child's record must be one the actor may change (see `loadEditableChild`: 403 group_read_only, 409 child_archived
 * for managers). A child the actor does not see answers the meeting's own 404 meeting_not_found, so nothing reveals it.
 */
function loadEditableMeeting(db: Db, actor: ChildActor, meetingId: number, now: Date): MeetingRow {
  const row = db.select({ meeting: childParentMeetings }).from(childParentMeetings)
    .innerJoin(children, eq(children.id, childParentMeetings.childId))
    .where(and(eq(childParentMeetings.id, meetingId), eq(children.facilityId, actor.facilityId))).get()
  if (!row) throw new ServiceError(404, 'meeting_not_found')
  try {
    loadEditableChild(db, actor, actor.facilityId, row.meeting.childId, nowInBerlin(now).date, now)
  }
  catch (error) {
    if (error instanceof ServiceError && error.code === 'child_not_found') throw new ServiceError(404, 'meeting_not_found')
    throw error
  }
  return row.meeting
}

/**
 * Enters a meeting in the child's record; returns its id. Whoever may change the record may (managers, Mitarbeiter
 * with the permission at the tablet in a group they may write in; see `loadEditableChild`). Who entered it is stored as
 * account, employee and name.
 */
export function addMeeting(
  db: Db, viewer: ChildViewer, childId: number, input: ParentMeetingInput, now: Date = new Date(),
): number {
  const actor = asChildEditor(viewer)
  loadEditableChild(db, actor, actor.facilityId, childId, nowInBerlin(now).date, now)
  const { note, ...fields } = checkedMeeting(actor, input)
  return db.insert(childParentMeetings).values({
    ...fields, note: note ?? '', childId, createdAt: now.toISOString(), createdByUserId: actor.id,
    createdByEmployeeId: actor.employeeId, createdByName: actor.name,
  }).returning({ id: childParentMeetings.id }).get().id
}

/**
 * Changes a meeting (the same rights as `addMeeting`) and stores who changed it when. A change without note keeps the
 * stored one: Mitarbeiter never see it, so their change leaves it as it is.
 */
export function updateMeeting(
  db: Db, viewer: ChildViewer, meetingId: number, input: ParentMeetingInput, now: Date = new Date(),
): void {
  const actor = asChildEditor(viewer)
  loadEditableMeeting(db, actor, meetingId, now)
  const { note, ...fields } = checkedMeeting(actor, input)
  db.update(childParentMeetings).set({
    ...fields, ...(note === undefined ? {} : { note }), updatedAt: now.toISOString(), updatedByName: actor.name,
  }).where(eq(childParentMeetings.id, meetingId)).run()
}

/** Deletes a meeting (the same rights as `addMeeting`). */
export function deleteMeeting(db: Db, viewer: ChildViewer, meetingId: number, now: Date = new Date()): void {
  const actor = asChildEditor(viewer)
  loadEditableMeeting(db, actor, meetingId, now)
  db.delete(childParentMeetings).where(eq(childParentMeetings.id, meetingId)).run()
}
