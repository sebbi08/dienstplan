import { and, desc, eq, gte, isNull, or } from 'drizzle-orm'
import { childStatus } from '../../shared/domain/children'
import { isValidIsoDate } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { ChildNoteDto, ChildNoteInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childNotes, children, employees } from '../db/schema'
import { loadEditableChild } from '../lib/childRecord'
import type { ChildViewer } from '../lib/childViewer'
import { ServiceError } from '../lib/errors'

type NoteRow = typeof childNotes.$inferSelect
type Author = Pick<ChildViewer, 'id' | 'employeeId'>

const MAX_TEXT = 2000

/**
 * Whether the viewer wrote the note: the same account, or the same person (at the tablet the one who unlocked it, with
 * the own account that account's employee), so a note entered at the tablet is the author's at the office as well.
 */
function isAuthor(row: Pick<NoteRow, 'createdByUserId' | 'createdByEmployeeId'>, viewer: Author): boolean {
  return (row.createdByUserId !== null && row.createdByUserId === viewer.id)
    || (row.createdByEmployeeId !== null && row.createdByEmployeeId === viewer.employeeId)
}

/** Who may change and delete a note: its author, Leitung and Träger (children.manage). */
function mayChange(row: NoteRow, viewer: Pick<ChildViewer, 'id' | 'employeeId' | 'permissions'>): boolean {
  return can(viewer.permissions, 'children.manage') || isAuthor(row, viewer)
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
 * once the employee is deleted) and whether the viewer may change it (never in an archived record). The caller has
 * checked that the viewer may read the record (see `getChild`).
 */
export function notesOf(
  db: Db, viewer: Pick<ChildViewer, 'id' | 'employeeId' | 'permissions'>, childId: number, today: IsoDate,
): ChildNoteDto[] {
  const child = db.select().from(children).where(eq(children.id, childId)).get()
  const archived = !child || childStatus(child, today) === 'archived'
  return db.select({ note: childNotes, educator: employees.name }).from(childNotes)
    .leftJoin(employees, eq(employees.id, childNotes.educatorEmployeeId))
    .where(eq(childNotes.childId, childId)).orderBy(desc(childNotes.date), desc(childNotes.id)).all()
    .map(({ note, educator }) => ({
      id: note.id, date: note.date, text: note.text, educatorEmployeeId: note.educatorEmployeeId,
      educatorName: educator ?? note.educatorName,
      createdByName: note.createdByName, createdAt: note.createdAt, updatedByName: note.updatedByName, updatedAt: note.updatedAt,
      canEdit: !archived && mayChange(note, viewer),
    }))
}

/**
 * The checked values: a valid day (400 invalid_date), a text of 1–2000 characters after trimming (400
 * child_note_text_invalid) and as educator none or an employee of the facility on today's staff list (400
 * child_note_educator_invalid); on a change the stored educator stays acceptable after they have left. Returns the columns
 * to store, with the educator's name saved alongside.
 */
function checkedNote(
  db: Db, facilityId: number, input: ChildNoteInput, today: IsoDate, stored?: NoteRow,
): Pick<NoteRow, 'date' | 'text' | 'educatorEmployeeId' | 'educatorName'> {
  if (!isValidIsoDate(input.date)) throw new ServiceError(400, 'invalid_date')
  const text = input.text.trim()
  if (text.length === 0 || text.length > MAX_TEXT) throw new ServiceError(400, 'child_note_text_invalid')
  const educatorId = input.educatorEmployeeId
  if (educatorId === null) return { date: input.date, text, educatorEmployeeId: null, educatorName: '' }
  if (stored && stored.educatorEmployeeId === educatorId) {
    const name = db.select({ name: employees.name }).from(employees).where(eq(employees.id, educatorId)).get()?.name
    return { date: input.date, text, educatorEmployeeId: educatorId, educatorName: name ?? stored.educatorName }
  }
  const educator = activeEmployee(db, facilityId, educatorId, today)
  if (!educator) throw new ServiceError(400, 'child_note_educator_invalid')
  return { date: input.date, text, educatorEmployeeId: educator.id, educatorName: educator.name }
}

/**
 * The note for a change by the viewer: it must belong to a child of the viewer's facility whose record the viewer sees
 * and which has not left (see `loadEditableChild` with a group to read: 409 child_archived for managers; otherwise
 * 404 child_note_not_found, so nothing reveals the child), and the viewer must be its author or Leitung/Träger (403
 * child_note_author_only).
 */
function loadChangeableNote(db: Db, viewer: ChildViewer, noteId: number, now: Date): NoteRow {
  const row = db.select({ note: childNotes }).from(childNotes)
    .innerJoin(children, eq(children.id, childNotes.childId))
    .where(and(eq(childNotes.id, noteId), eq(children.facilityId, viewer.facilityId))).get()
  if (!row) throw new ServiceError(404, 'child_note_not_found')
  try {
    loadEditableChild(db, viewer, viewer.facilityId, row.note.childId, nowInBerlin(now).date, now, 'read')
  }
  catch (error) {
    if (error instanceof ServiceError && error.code === 'child_not_found') throw new ServiceError(404, 'child_note_not_found')
    throw error
  }
  if (!mayChange(row.note, viewer)) throw new ServiceError(403, 'child_note_author_only')
  return row.note
}

/**
 * Enters a note in the child's record; returns its id. Everyone who sees the record may (spec: „alle Mitarbeiter können
 * Notizen zum Kind machen“), so not only who may change it (children.edit): also in a group the person may only read,
 * and at the tablet a person without an account. Not in the record of a child that has left (see `loadEditableChild`).
 * Who entered it is stored as account, employee and name.
 */
export function addNote(db: Db, viewer: ChildViewer, childId: number, input: ChildNoteInput, now: Date = new Date()): number {
  const today = nowInBerlin(now).date
  loadEditableChild(db, viewer, viewer.facilityId, childId, today, now, 'read')
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
