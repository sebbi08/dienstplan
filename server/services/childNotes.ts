import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import { isValidIsoDate } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { ChildNoteDto, ChildNoteInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childNotes, children, employees } from '../db/schema'
import { loadEditableChild } from '../lib/childRecord'
import { groupRightOf, type ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'

type NoteRow = typeof childNotes.$inferSelect
type ChildRow = typeof children.$inferSelect
type NoteViewer = Pick<ChildViewer, 'id' | 'employeeId' | 'permissions' | 'groups' | 'writeGroups'>

const MAX_TEXT = 2000

/**
 * Whether the viewer wrote the note: the same account, or the same person (at the tablet the one who unlocked it, with
 * the own account that account's employee), so a note entered at the tablet is the author's at the office as well.
 */
function isAuthor(row: Pick<NoteRow, 'createdByUserId' | 'createdByEmployeeId'>, viewer: Pick<ChildViewer, 'id' | 'employeeId'>): boolean {
  return (row.createdByUserId !== null && row.createdByUserId === viewer.id)
    || (row.createdByEmployeeId !== null && row.createdByEmployeeId === viewer.employeeId)
}

/** Who may change and delete a note where they write notes at all: its author, Leitung and Träger (children.manage). */
function mayChange(row: NoteRow, viewer: Pick<ChildViewer, 'id' | 'employeeId' | 'permissions'>): boolean {
  return can(viewer.permissions, 'children.manage') || isAuthor(row, viewer)
}

/**
 * Whether the viewer writes notes in this child's record. Ruling: the same people as the attendance, with the same
 * group scope, so children.attendance in a group whose attendance the viewer writes; never in a group they may only
 * read, and never in the record of a child that has left. At the tablet a person without an account and a helper from
 * another facility therefore write notes exactly as far as they write the attendance (both have the Mitarbeiter role
 * settings and every group); a role setting without the attendance takes the notes as well.
 */
export function mayWriteNotes(
  viewer: Pick<ChildViewer, 'permissions' | 'groups' | 'writeGroups'>,
  child: Pick<ChildRow, 'groupId' | 'admissionStatus' | 'entryDate' | 'leftOn'>, today: IsoDate,
): boolean {
  return childStatus(child, today) !== 'archived' && can(viewer.permissions, 'children.attendance')
    && groupRightOf(viewer, child.groupId, 'children.attendance') === 'write'
}

/** The facility's employee on the staff list today (not left before today), or undefined. */
function activeEmployee(db: Db, facilityId: number, employeeId: number, today: IsoDate): { id: number; name: string } | undefined {
  return db.select({ id: employees.id, name: employees.name }).from(employees).where(and(
    eq(employees.id, employeeId), eq(employees.facilityId, facilityId), or(isNull(employees.leftOn), gte(employees.leftOn, today)),
  )).get()
}

/**
 * The educator a new note starts with: the acting person (at the tablet the one who unlocked it, else the account's
 * employee) when they are on the facility's staff list today, else none.
 */
export function defaultNoteEducator(db: Db, viewer: Pick<ChildViewer, 'employeeId' | 'facilityId'>, today: IsoDate): number | null {
  if (viewer.employeeId === null) return null
  return activeEmployee(db, viewer.facilityId, viewer.employeeId, today)?.id ?? null
}

/**
 * The child's notes, newest date first, then the newest entered; each with the educator's current name (the saved one
 * once the employee is gone) and whether the viewer may change it (`mayWriteNotes` and `mayChange`). The caller has
 * checked that the viewer may read the record (see `getChild`).
 */
export function notesOf(db: Db, viewer: NoteViewer, childId: number, today: IsoDate): ChildNoteDto[] {
  const child = db.select().from(children).where(eq(children.id, childId)).get()
  const writable = child !== undefined && mayWriteNotes(viewer, child, today)
  return db.select({ note: childNotes, educator: employees.name }).from(childNotes)
    .leftJoin(employees, eq(employees.id, childNotes.educatorEmployeeId))
    .where(eq(childNotes.childId, childId)).orderBy(desc(childNotes.date), desc(childNotes.id)).all()
    .map(({ note, educator }) => ({
      id: note.id, date: note.date, text: note.text, educatorEmployeeId: note.educatorEmployeeId,
      educatorName: educator ?? note.educatorName,
      createdByName: note.createdByName, createdAt: note.createdAt, updatedByName: note.updatedByName, updatedAt: note.updatedAt,
      canEdit: writable && mayChange(note, viewer),
    }))
}

/**
 * The checked values: a valid day (400 invalid_date), a text of 1–2000 characters after trimming (400
 * child_note_text_invalid) and as educator none, an employee of the facility on today's staff list or, on a change,
 * 'keep' for the stored educator with the saved name (400 child_note_educator_invalid otherwise; 'keep' when entering a
 * note too). On a change the stored educator also stays acceptable by id after they have left. Returns the columns to
 * store, with the educator's name saved alongside.
 */
function checkedNote(
  db: Db, facilityId: number, input: ChildNoteInput, today: IsoDate, stored?: NoteRow,
): Pick<NoteRow, 'date' | 'text' | 'educatorEmployeeId' | 'educatorName'> {
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'invalid_date')
  const text = input.text.trim()
  if (text.length === 0 || text.length > MAX_TEXT) throw new ServiceError(400, 'child_note_text_invalid')
  const educatorId = input.educatorEmployeeId
  if (educatorId === 'keep') {
    if (!stored) throw new ServiceError(400, 'child_note_educator_invalid')
    return { date: input.date, text, educatorEmployeeId: stored.educatorEmployeeId, educatorName: stored.educatorName }
  }
  if (educatorId === null) return { date: input.date, text, educatorEmployeeId: null, educatorName: '' }
  if (stored && stored.educatorEmployeeId === educatorId) {
    const name = db.select({ name: employees.name }).from(employees).where(eq(employees.id, educatorId)).get()?.name
    return { date: input.date, text, educatorEmployeeId: educatorId, educatorName: name ?? stored.educatorName }
  }
  const educator = activeEmployee(db, facilityId, educatorId, today)
  if (!educator) throw new ServiceError(400, 'child_note_educator_invalid')
  return { date: input.date, text, educatorEmployeeId: educator.id, educatorName: educator.name }
}

/** 403 forbidden without the attendance permission: notes are written by whoever keeps the attendance (`mayWriteNotes`). */
function assertNoteWriter(viewer: ChildViewer): void {
  if (!can(viewer.permissions, 'children.attendance')) throw new ServiceError(403, 'forbidden')
}

/**
 * The note for a change by the viewer: it must belong to a child of the viewer's facility whose record the viewer sees
 * and which has not left, in a group whose attendance the viewer writes (see `loadEditableChild` with the attendance's
 * scope: 409 child_archived for managers, 403 group_read_only for a group the viewer only reads; otherwise 404
 * child_note_not_found, so nothing reveals the child), and the viewer must be its author or Leitung/Träger (403
 * child_note_author_only).
 */
function loadChangeableNote(db: Db, viewer: ChildViewer, noteId: number, now: Date): NoteRow {
  assertNoteWriter(viewer)
  const row = db.select({ note: childNotes }).from(childNotes)
    .innerJoin(children, eq(children.id, childNotes.childId))
    .where(and(eq(childNotes.id, noteId), eq(children.facilityId, viewer.facilityId))).get()
  if (!row) throw new ServiceError(404, 'child_note_not_found')
  try {
    loadEditableChild(db, viewer, viewer.facilityId, row.note.childId, nowInBerlin(now).date, now, 'children.attendance')
  }
  catch (error) {
    if (error instanceof ServiceError && error.code === 'child_not_found') throw new ServiceError(404, 'child_note_not_found')
    throw error
  }
  if (!mayChange(row.note, viewer)) throw new ServiceError(403, 'child_note_author_only')
  return row.note
}

/**
 * Enters a note in the child's record; returns its id. Whoever keeps the child's attendance may (`mayWriteNotes`;
 * spec: „alle Mitarbeiter können Notizen zum Kind machen“), so not only who may change the record (children.edit), and
 * at the tablet also a person without an account; not in a group the viewer only reads (403 group_read_only) and not
 * in the record of a child that has left (see `loadEditableChild`). Who entered it is stored as account, employee and
 * name.
 */
export function addNote(db: Db, viewer: ChildViewer, childId: number, input: ChildNoteInput, now: Date = new Date()): number {
  assertNoteWriter(viewer)
  const today = nowInBerlin(now).date
  loadEditableChild(db, viewer, viewer.facilityId, childId, today, now, 'children.attendance')
  return db.insert(childNotes).values({
    ...checkedNote(db, viewer.facilityId, input, today), childId, createdAt: now.toISOString(), createdByUserId: viewer.id,
    createdByEmployeeId: viewer.employeeId, createdByName: viewer.name,
  }).returning({ id: childNotes.id }).get().id
}

/** Changes a note (its author, Leitung and Träger; see `loadChangeableNote`) and stores who changed it when. */
export function updateNote(db: Db, viewer: ChildViewer, noteId: number, input: ChildNoteInput, now: Date = new Date()): void {
  const stored = loadChangeableNote(db, viewer, noteId, now)
  db.update(childNotes).set({
    ...checkedNote(db, viewer.facilityId, input, nowInBerlin(now).date, stored), updatedAt: now.toISOString(),
    updatedByName: viewer.name,
  }).where(eq(childNotes.id, noteId)).run()
}

/** Deletes a note (the same rights as `updateNote`). */
export function deleteNote(db: Db, viewer: ChildViewer, noteId: number, now: Date = new Date()): void {
  loadChangeableNote(db, viewer, noteId, now)
  db.delete(childNotes).where(eq(childNotes.id, noteId)).run()
}

/**
 * The record moves to another facility: its notes keep no link to the old facility's employees. The educator's name is
 * saved as it is now and the educator link cleared; the author's employee link goes as well (the name stays), so
 * nobody of the old facility counts as author by their employee there.
 */
export function detachNoteEmployees(tx: Db, childId: number): void {
  tx.update(childNotes).set({
    educatorName: sql`coalesce((select ${employees.name} from ${employees} where ${employees.id} = ${childNotes.educatorEmployeeId}), ${childNotes.educatorName})`,
    educatorEmployeeId: null,
    createdByEmployeeId: null,
  }).where(eq(childNotes.childId, childId)).run()
}
