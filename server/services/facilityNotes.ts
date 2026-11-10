import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { visibleTemplateLevels } from '../../shared/domain/templateCategories'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import {
  isGroupColor, type NoteDto, type NoteInput, type NotesDto, type NoteVisibility, type SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, facilityNotes, groups } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { actorName } from './formTemplates'

export const NOTE_TEXT_MAX = 1000
/** The longest search (chars after trimming); the list query refuses a longer one. */
export const NOTE_SEARCH_MAX = 100

/** The signed-in user (or the tablet) in the facility the route works in (the route's `FacilityUser`). */
export type NotesActor = SessionUser & { facilityId: number }

/** The list filter: every note, only those of the whole facility, or those of one group and of the whole facility. */
export type NoteGroupFilter = 'all' | 'facility' | number

type NoteRow = typeof facilityNotes.$inferSelect

/**
 * The visibilities „Sichtbar für“ the actor reads, and so also may choose when writing — the rule of the print-template
 * categories: the Träger all three, the Leitung 'all' and 'managers', everyone else (Gruppenleitung, Mitarbeiter, also
 * with a write exception) and the tablet only 'all'.
 */
const noteLevels = (actor: NotesActor): NoteVisibility[] => visibleTemplateLevels(actor.role)

/** The query condition: only notes of a level the actor reads (applied before any search or count). */
const readable = (actor: NotesActor) => inArray(facilityNotes.visibility, noteLevels(actor))

/**
 * What the actor may write: null without notes.write (the tablet never); `facility` with the scope „ganze
 * Einrichtung“, else only for the own group `groupId` (the group of the linked employee, if it is one of the facility;
 * null: none); `visibilities` the levels the actor may choose (noteLevels).
 */
function writeAccess(db: Db, actor: NotesActor): NotesDto['write'] {
  if (actor.role === 'terminal' || !can(actor.permissions, 'notes.write')) return null
  const visibilities = noteLevels(actor)
  if (actor.scopes.get('notes.write') === 'facility') return { facility: true, groupId: null, visibilities }
  if (actor.employeeId === null) return { facility: false, groupId: null, visibilities }
  const own = db.select({ id: groups.id }).from(employees)
    .innerJoin(groups, eq(groups.id, employees.groupId))
    .where(and(eq(employees.id, actor.employeeId), eq(groups.facilityId, actor.facilityId))).get()
  return { facility: false, groupId: own?.id ?? null, visibilities }
}

/** Whether `write` covers a note of the group (null = the whole facility). */
function mayWrite(write: NotesDto['write'], groupId: number | null): boolean {
  if (write === null) return false
  return write.facility || (write.groupId !== null && groupId === write.groupId)
}

/** 403 forbidden without notes.write, 403 notes_no_group with the own-group scope but no own group. */
function requireWriter(db: Db, actor: NotesActor): NonNullable<NotesDto['write']> {
  const write = writeAccess(db, actor)
  if (write === null) throw new ServiceError(403, 'forbidden')
  if (!write.facility && write.groupId === null) throw new ServiceError(403, 'notes_no_group')
  return write
}

/** 404 group_not_found unless the group belongs to the facility. */
function assertFacilityGroup(db: Db, facilityId: number, groupId: number): void {
  const found = db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), eq(groups.facilityId, facilityId))).get()
  if (!found) throw new ServiceError(404, 'group_not_found')
}

/** The facility's groups in their order, with their colour. */
function facilityGroups(db: Db, facilityId: number): NotesDto['groups'] {
  return db.select({ id: groups.id, name: groups.name, color: groups.color }).from(groups)
    .where(eq(groups.facilityId, facilityId)).orderBy(asc(groups.sortOrder), asc(groups.id)).all()
    .map(group => ({ id: group.id, name: group.name, color: group.color !== null && isGroupColor(group.color) ? group.color : null }))
}

function toDto(row: NoteRow, names: ReadonlyMap<number, string>, write: NotesDto['write']): NoteDto {
  return {
    id: row.id, groupId: row.groupId, groupName: row.groupId === null ? null : names.get(row.groupId) ?? null,
    validUntil: row.validUntil, text: row.text, visibility: row.visibility, createdAt: row.createdAt, createdBy: row.createdBy,
    updatedAt: row.updatedAt, updatedBy: row.updatedBy, canEdit: mayWrite(write, row.groupId),
  }
}

/** German lower case in one Unicode form, so „BÄREN“ and a typed „bären“ both find „Bären“. */
const folded = (value: string): string => value.normalize('NFC').toLocaleLowerCase('de-DE')

/** The search words of `q` (trimmed, at most NOTE_SEARCH_MAX chars), folded; none for an empty search. */
function searchWords(q: string): string[] {
  return folded(q.trim().slice(0, NOTE_SEARCH_MAX)).split(/\s+/).filter(word => word !== '')
}

/** Whether every word is in the note's text or in the name of who wrote or changed it. */
function matches(row: NoteRow, words: readonly string[]): boolean {
  if (words.length === 0) return true
  // One line per field: a word has no whitespace, so it never matches across two fields.
  const haystack = folded([row.text, row.createdBy, row.updatedBy ?? ''].join('\n'))
  return words.every(word => haystack.includes(word))
}

/**
 * The notes of the actor's facility for the page „Notizen“ (every person of the facility and the tablet), split into
 * those that apply (no „gilt bis“ or from `today` on) and the expired ones, each newest first; with the groups and what
 * the actor may write. `q`: only the notes whose text or names hold every word of it (case-insensitive, the expired
 * ones too); the group filter applies as well. Only notes of a level the actor reads (noteLevels), filtered in the
 * query, so the search never finds the others. A group of another facility as filter is 404 group_not_found.
 */
export function listNotes(
  db: Db, actor: NotesActor, filter: { group: NoteGroupFilter; q?: string }, today: IsoDate,
): NotesDto {
  if (typeof filter.group === 'number') assertFacilityGroup(db, actor.facilityId, filter.group)
  const ofGroup = filter.group === 'all'
    ? undefined
    : filter.group === 'facility'
      ? isNull(facilityNotes.groupId)
      : or(isNull(facilityNotes.groupId), eq(facilityNotes.groupId, filter.group))
  const rows = db.select().from(facilityNotes).where(and(eq(facilityNotes.facilityId, actor.facilityId), readable(actor), ofGroup))
    .orderBy(desc(facilityNotes.createdAt), desc(facilityNotes.id)).all()
  const groupList = facilityGroups(db, actor.facilityId)
  const names = new Map(groupList.map(group => [group.id, group.name]))
  const write = writeAccess(db, actor)
  const dto = (row: NoteRow) => toDto(row, names, write)
  const words = searchWords(filter.q ?? '')
  const found = rows.filter(row => matches(row, words))
  return {
    current: found.filter(row => row.validUntil === null || row.validUntil >= today).map(dto),
    expired: found.filter(row => row.validUntil !== null && row.validUntil < today).map(dto),
    groups: groupList,
    write,
  }
}

/** A checked note: the trimmed text, „gilt bis“ (null for none), the group and „Sichtbar für“. */
type CheckedNote = Pick<NoteRow, 'groupId' | 'validUntil' | 'text' | 'visibility'>

/**
 * Text 1–1000 chars after trimming (400 note_text_invalid); „gilt bis“ empty or a valid date, on create not before
 * `today` (400 note_valid_until_invalid); the group one the writer may write for (403 forbidden) and of the facility
 * (404 group_not_found); „Sichtbar für“ (absent: 'all' for a new note, the stored level of the changed note `current`)
 * one of `write.visibilities` (403 forbidden).
 */
function checkedNote(
  db: Db, actor: NotesActor, write: NonNullable<NotesDto['write']>, input: NoteInput, today: IsoDate,
  current: NoteRow | null,
): CheckedNote {
  const creating = current === null
  const visibility = input.visibility ?? current?.visibility ?? 'all'
  const text = input.text.trim()
  if (text.length < 1 || text.length > NOTE_TEXT_MAX) throw new ServiceError(400, 'note_text_invalid')
  let validUntil: string | null = null
  if (input.validUntil !== null && input.validUntil !== '') {
    if (!isValidIsoDate(input.validUntil) || (creating && input.validUntil < today)) {
      throw new ServiceError(400, 'note_valid_until_invalid')
    }
    validUntil = input.validUntil
  }
  if (!mayWrite(write, input.groupId)) throw new ServiceError(403, 'forbidden')
  if (!write.visibilities.includes(visibility)) throw new ServiceError(403, 'forbidden')
  if (input.groupId !== null) assertFacilityGroup(db, actor.facilityId, input.groupId)
  return { groupId: input.groupId, validUntil, text, visibility }
}

/**
 * A note of the actor's facility of a level the actor reads; another facility's note and one the actor does not see
 * are 404 note_not_found (no existence leak).
 */
function loadNote(db: Db, actor: NotesActor, id: number): NoteRow {
  const row = db.select().from(facilityNotes)
    .where(and(eq(facilityNotes.id, id), eq(facilityNotes.facilityId, actor.facilityId), readable(actor))).get()
  if (!row) throw new ServiceError(404, 'note_not_found')
  return row
}

/** The note as the writer sees it after a change. */
function savedDto(db: Db, actor: NotesActor, write: NotesDto['write'], row: NoteRow): NoteDto {
  const names = new Map(facilityGroups(db, actor.facilityId).map(group => [group.id, group.name]))
  return toDto(row, names, write)
}

/** A new note of the actor's facility with the writer's name (notes.write; see checkedNote). */
export function createNote(db: Db, actor: NotesActor, input: NoteInput, now: Date = new Date()): NoteDto {
  const write = requireWriter(db, actor)
  const note = checkedNote(db, actor, write, input, nowInBerlin(now).date, null)
  const row = db.insert(facilityNotes).values({
    facilityId: actor.facilityId, ...note, createdAt: now.toISOString(), createdBy: actorName(db, actor),
  }).returning().get()
  return savedDto(db, actor, write, row)
}

/**
 * Changes a note the actor may write for (403 forbidden for another group's or the facility's note with the own-group
 * scope; 404 note_not_found for one the actor does not see; see checkedNote). Keeps the name and time of the change.
 */
export function updateNote(db: Db, actor: NotesActor, id: number, input: NoteInput, now: Date = new Date()): NoteDto {
  const write = requireWriter(db, actor)
  const current = loadNote(db, actor, id)
  if (!mayWrite(write, current.groupId)) throw new ServiceError(403, 'forbidden')
  const note = checkedNote(db, actor, write, input, nowInBerlin(now).date, current)
  const row = db.update(facilityNotes).set({ ...note, updatedAt: now.toISOString(), updatedBy: actorName(db, actor) })
    .where(eq(facilityNotes.id, current.id)).returning().get()!
  return savedDto(db, actor, write, row)
}

/** Deletes a note the actor may write for (see updateNote). */
export function deleteNote(db: Db, actor: NotesActor, id: number): void {
  const write = requireWriter(db, actor)
  const current = loadNote(db, actor, id)
  if (!mayWrite(write, current.groupId)) throw new ServiceError(403, 'forbidden')
  db.delete(facilityNotes).where(eq(facilityNotes.id, current.id)).run()
}
