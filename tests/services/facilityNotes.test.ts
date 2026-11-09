import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { facilityNotes, groups } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { noteInputSchema, notesQuery } from '../../server/schemas'
import {
  createNote, deleteNote, listNotes, updateNote, type NotesActor,
} from '../../server/services/facilityNotes'
import { getActiveUser } from '../../server/services/auth'
import { deleteGroup } from '../../server/services/groups'
import { saveBundleOverride } from '../../server/services/permissions'
import type { NoteInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb } from '../helpers/fixtures'

const TODAY = '2026-11-09'
const NOW = new Date('2026-11-09T08:00:00Z')
const LATER = new Date('2026-11-09T09:00:00Z')

/** "<status> <code>" of the ServiceError fn throws, or null if it does not throw. */
function failure(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return `${error.statusCode} ${error.code}`
    throw error
  }
}

const asActor = (user: SessionUser): NotesActor => {
  if (user.facilityId === null) throw new Error('test user without facility')
  return user as NotesActor
}

const board = (more: Partial<NoteInput> = {}): NoteInput =>
  ({ kind: 'board', groupId: null, date: null, validUntil: null, text: 'Pinnwand', ...more })
const day = (date: string, more: Partial<NoteInput> = {}): NoteInput =>
  ({ kind: 'day', groupId: null, date, validUntil: null, text: 'Tag', ...more })

describe('facility notes', () => {
  let db: Db
  let facilityB: number
  let baeren: number
  let fuechse: number
  let eulenB: number
  let leitung: NotesActor
  let traeger: NotesActor
  let gruppenleitung: NotesActor
  let springer: NotesActor
  let mitarbeiter: NotesActor
  let tablet: NotesActor
  let leitungB: NotesActor

  /** Inserts a note directly with the given creation time (to test the order). */
  const insert = (values: Partial<typeof facilityNotes.$inferInsert> & { kind: 'board' | 'day' }) =>
    db.insert(facilityNotes).values({
      facilityId: 1, groupId: null, date: null, validUntil: null, text: 'x', createdAt: NOW.toISOString(), createdBy: 'Test',
      ...values,
    }).returning({ id: facilityNotes.id }).get().id
  const ids = (notes: { id: number }[]) => notes.map(note => note.id)

  beforeEach(() => {
    db = createTestDb()
    facilityB = addFacility(db, 'Krippe')
    baeren = addGroup(db, 1, 'Bären')
    fuechse = addGroup(db, 1, 'Füchse')
    eulenB = addGroup(db, facilityB, 'Eulen')
    db.update(groups).set({ color: 'teal' }).where(eq(groups.id, baeren)).run()
    leitung = asActor(addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung')))
    traeger = asActor(addUser(db, 'traeger', 'provider'))
    gruppenleitung = asActor(addUser(db, 'gina', 'group_lead', addEmployee(db, 'Gina', { groupId: baeren })))
    springer = asActor(addUser(db, 'sam', 'group_lead', addEmployee(db, 'Sam')))
    mitarbeiter = asActor(addUser(db, 'mia', 'observer', addEmployee(db, 'Mia', { groupId: baeren })))
    tablet = asActor(addUser(db, 'tablet-test', 'terminal'))
    leitungB = asActor(addUser(db, 'leitb', 'admin', null, facilityB))
  })

  describe('writing', () => {
    it('Leitung and Träger create for the whole facility and for any group, with their name and time', () => {
      const facilityNote = createNote(db, leitung, board({ text: '  Elternabend am Freitag  ' }), NOW)
      const groupNote = createNote(db, traeger, day('2026-11-12', { groupId: fuechse }), NOW)
      const list = listNotes(db, leitung, { group: 'all' }, TODAY)
      expect(list.board).toEqual([{
        id: facilityNote.id, kind: 'board', groupId: null, groupName: null, date: null, validUntil: null,
        text: 'Elternabend am Freitag', createdAt: NOW.toISOString(), createdBy: 'Lea Leitung', updatedAt: null, updatedBy: null,
        canEdit: true,
      }])
      expect(list.upcoming).toMatchObject([{ id: groupNote.id, kind: 'day', groupId: fuechse, groupName: 'Füchse', date: '2026-11-12', createdBy: 'traeger' }])
      expect(createNote(db, leitung, board({ groupId: baeren }), NOW).groupId).toBe(baeren)
    })

    it('a Gruppenleitung writes only for her own group (403 forbidden for the facility or another group)', () => {
      const own = createNote(db, gruppenleitung, board({ groupId: baeren }), NOW)
      expect(own).toMatchObject({ groupId: baeren, createdBy: 'Gina', canEdit: true })
      expect(failure(() => createNote(db, gruppenleitung, board({ groupId: fuechse }), NOW))).toBe('403 forbidden')
      expect(failure(() => createNote(db, gruppenleitung, board({ groupId: null }), NOW))).toBe('403 forbidden')
      expect(failure(() => createNote(db, gruppenleitung, board({ groupId: eulenB }), NOW))).toBe('403 forbidden')
    })

    it('a Gruppenleitung changes and deletes only notes of her own group', () => {
      const facilityNote = createNote(db, leitung, board(), NOW).id
      const otherGroup = createNote(db, leitung, board({ groupId: fuechse }), NOW).id
      const own = createNote(db, leitung, board({ groupId: baeren }), NOW).id
      for (const id of [facilityNote, otherGroup]) {
        expect(failure(() => updateNote(db, gruppenleitung, id, board({ groupId: baeren }), LATER))).toBe('403 forbidden')
        expect(failure(() => deleteNote(db, gruppenleitung, id))).toBe('403 forbidden')
      }
      // Moving her own note to the facility or another group is not hers to do either.
      expect(failure(() => updateNote(db, gruppenleitung, own, board({ groupId: null }), LATER))).toBe('403 forbidden')
      expect(failure(() => updateNote(db, gruppenleitung, own, board({ groupId: fuechse }), LATER))).toBe('403 forbidden')
      expect(updateNote(db, gruppenleitung, own, board({ groupId: baeren, text: 'neu' }), LATER).text).toBe('neu')
      deleteNote(db, gruppenleitung, own)
      expect(db.select().from(facilityNotes).where(eq(facilityNotes.id, own)).get()).toBeUndefined()
    })

    it('a Springer-Gruppenleitung without a group has nothing to write (403 notes_no_group)', () => {
      const id = createNote(db, leitung, board(), NOW).id
      expect(failure(() => createNote(db, springer, board({ groupId: baeren }), NOW))).toBe('403 notes_no_group')
      expect(failure(() => createNote(db, springer, board(), NOW))).toBe('403 notes_no_group')
      expect(failure(() => updateNote(db, springer, id, board(), LATER))).toBe('403 notes_no_group')
      expect(failure(() => deleteNote(db, springer, id))).toBe('403 notes_no_group')
      expect(listNotes(db, springer, { group: 'all' }, TODAY).write).toEqual({ facility: false, groupId: null })
    })

    it('without notes.write (Mitarbeiter, tablet) the service refuses (403 forbidden)', () => {
      const id = createNote(db, leitung, board(), NOW).id
      for (const actor of [mitarbeiter, tablet]) {
        expect(failure(() => createNote(db, actor, board({ groupId: baeren }), NOW))).toBe('403 forbidden')
        expect(failure(() => updateNote(db, actor, id, board(), LATER))).toBe('403 forbidden')
        expect(failure(() => deleteNote(db, actor, id))).toBe('403 forbidden')
      }
    })

    it('a Mitarbeiter with the exception „schreiben“ (own group) writes for her group only', () => {
      saveBundleOverride(db, mitarbeiter.id, 'notesWrite', 'grant', 'group')
      // The rights are read when the session user is loaded (the next request).
      const mia = asActor(getActiveUser(db, mitarbeiter.id, TODAY)!)
      expect(listNotes(db, mia, { group: 'all' }, TODAY).write).toEqual({ facility: false, groupId: baeren })
      expect(createNote(db, mia, board({ groupId: baeren }), NOW).createdBy).toBe('Mia')
      expect(failure(() => createNote(db, mia, board(), NOW))).toBe('403 forbidden')
    })

    it('keeps who changed a note and when; the kind cannot change (400 note_kind_fixed)', () => {
      const id = createNote(db, leitung, board(), NOW).id
      const changed = updateNote(db, traeger, id, board({ text: 'Geändert', validUntil: '2026-12-01' }), LATER)
      expect(changed).toMatchObject({
        text: 'Geändert', validUntil: '2026-12-01', createdBy: 'Lea Leitung', createdAt: NOW.toISOString(),
        updatedBy: 'traeger', updatedAt: LATER.toISOString(),
      })
      expect(failure(() => updateNote(db, leitung, id, day('2026-11-10'), LATER))).toBe('400 note_kind_fixed')
    })

    it('checks the text (trimmed 1–1000 chars)', () => {
      expect(failure(() => createNote(db, leitung, board({ text: '   ' }), NOW))).toBe('400 note_text_invalid')
      expect(failure(() => createNote(db, leitung, board({ text: 'x'.repeat(1001) }), NOW))).toBe('400 note_text_invalid')
      expect(createNote(db, leitung, board({ text: ` ${'x'.repeat(1000)} ` }), NOW).text).toHaveLength(1000)
      const id = createNote(db, leitung, board(), NOW).id
      expect(failure(() => updateNote(db, leitung, id, board({ text: '' }), LATER))).toBe('400 note_text_invalid')
    })

    it('a day note needs a valid date; a board note clears the date', () => {
      expect(failure(() => createNote(db, leitung, { ...day('x'), date: null }, NOW))).toBe('400 note_date_invalid')
      expect(failure(() => createNote(db, leitung, day('2026-02-30'), NOW))).toBe('400 note_date_invalid')
      expect(failure(() => createNote(db, leitung, day(''), NOW))).toBe('400 note_date_invalid')
      // A past day may be noted.
      expect(createNote(db, leitung, day('2026-11-02'), NOW).date).toBe('2026-11-02')
      expect(createNote(db, leitung, board({ date: '2026-11-12' }), NOW).date).toBeNull()
    })

    it('„gilt bis“ only for board notes: a valid date, on create not before today', () => {
      expect(failure(() => createNote(db, leitung, board({ validUntil: '2026-11-08' }), NOW))).toBe('400 note_valid_until_invalid')
      expect(failure(() => createNote(db, leitung, board({ validUntil: '2026-13-01' }), NOW))).toBe('400 note_valid_until_invalid')
      expect(createNote(db, leitung, board({ validUntil: TODAY }), NOW).validUntil).toBe(TODAY)
      expect(createNote(db, leitung, board({ validUntil: '' }), NOW).validUntil).toBeNull()
      // A day note keeps no „gilt bis“.
      expect(createNote(db, leitung, day('2026-11-10', { validUntil: '2026-11-20' }), NOW).validUntil).toBeNull()
      // On a change, an expired „gilt bis“ may stay.
      const id = insert({ kind: 'board', validUntil: '2026-11-01' })
      expect(updateNote(db, leitung, id, board({ validUntil: '2026-11-01', text: 'neu' }), LATER).validUntil).toBe('2026-11-01')
      expect(failure(() => updateNote(db, leitung, id, board({ validUntil: 'gestern' }), LATER))).toBe('400 note_valid_until_invalid')
    })

    it('another facility: its group 404 group_not_found, its note 404 note_not_found', () => {
      expect(failure(() => createNote(db, leitung, board({ groupId: eulenB }), NOW))).toBe('404 group_not_found')
      expect(failure(() => createNote(db, leitung, board({ groupId: 99999 }), NOW))).toBe('404 group_not_found')
      const id = createNote(db, leitung, board(), NOW).id
      expect(failure(() => updateNote(db, leitungB, id, board(), LATER))).toBe('404 note_not_found')
      expect(failure(() => deleteNote(db, leitungB, id))).toBe('404 note_not_found')
      expect(failure(() => updateNote(db, leitung, 99999, board(), LATER))).toBe('404 note_not_found')
      const own = createNote(db, leitung, board({ groupId: baeren }), NOW).id
      expect(failure(() => updateNote(db, leitung, own, board({ groupId: eulenB }), LATER))).toBe('404 group_not_found')
      expect(listNotes(db, leitungB, { group: 'all' }, TODAY).board).toEqual([])
    })

    it('deleting a group turns its notes into notes of the whole facility', () => {
      const id = createNote(db, leitung, board({ groupId: fuechse }), NOW).id
      deleteGroup(db, 1, fuechse, TODAY)
      expect(listNotes(db, leitung, { group: 'facility' }, TODAY).board).toMatchObject([{ id, groupId: null, groupName: null }])
    })
  })

  describe('reading', () => {
    it('every role of the facility and the tablet read all notes; write only with notes.write', () => {
      const facilityNote = createNote(db, leitung, board(), NOW).id
      const groupNote = createNote(db, leitung, board({ groupId: fuechse }), NOW).id
      for (const actor of [leitung, traeger, gruppenleitung, springer, mitarbeiter, tablet]) {
        expect(ids(listNotes(db, actor, { group: 'all' }, TODAY).board).sort()).toEqual([facilityNote, groupNote].sort())
      }
      expect(listNotes(db, leitung, { group: 'all' }, TODAY).write).toEqual({ facility: true, groupId: null })
      expect(listNotes(db, traeger, { group: 'all' }, TODAY).write).toEqual({ facility: true, groupId: null })
      expect(listNotes(db, gruppenleitung, { group: 'all' }, TODAY).write).toEqual({ facility: false, groupId: baeren })
      expect(listNotes(db, mitarbeiter, { group: 'all' }, TODAY).write).toBeNull()
      expect(listNotes(db, tablet, { group: 'all' }, TODAY).write).toBeNull()
    })

    it('marks per note whether the reader may change it', () => {
      const facilityNote = createNote(db, leitung, board(), NOW).id
      const own = createNote(db, leitung, board({ groupId: baeren }), NOW).id
      const other = createNote(db, leitung, board({ groupId: fuechse }), NOW).id
      const canEdit = (actor: NotesActor) => Object.fromEntries(
        listNotes(db, actor, { group: 'all' }, TODAY).board.map(note => [note.id, note.canEdit]),
      )
      expect(canEdit(leitung)).toEqual({ [facilityNote]: true, [own]: true, [other]: true })
      expect(canEdit(traeger)).toEqual({ [facilityNote]: true, [own]: true, [other]: true })
      expect(canEdit(gruppenleitung)).toEqual({ [facilityNote]: false, [own]: true, [other]: false })
      expect(canEdit(springer)).toEqual({ [facilityNote]: false, [own]: false, [other]: false })
      expect(canEdit(mitarbeiter)).toEqual({ [facilityNote]: false, [own]: false, [other]: false })
      expect(canEdit(tablet)).toEqual({ [facilityNote]: false, [own]: false, [other]: false })
    })

    it('lists the facility groups in their order with their colour', () => {
      expect(listNotes(db, mitarbeiter, { group: 'all' }, TODAY).groups).toEqual([
        { id: baeren, name: 'Bären', color: 'teal' }, { id: fuechse, name: 'Füchse', color: null },
      ])
    })

    it('splits board/expired/upcoming/past in their order; „gilt bis“ today still applies', () => {
      const boardOld = insert({ kind: 'board', createdAt: '2026-11-01T08:00:00.000Z' })
      const boardNew = insert({ kind: 'board', createdAt: '2026-11-05T08:00:00.000Z', validUntil: TODAY })
      const boardLater = insert({ kind: 'board', createdAt: '2026-11-03T08:00:00.000Z', validUntil: '2026-12-31' })
      const expiredOld = insert({ kind: 'board', createdAt: '2026-10-01T08:00:00.000Z', validUntil: '2026-11-08' })
      const expiredNew = insert({ kind: 'board', createdAt: '2026-10-05T08:00:00.000Z', validUntil: '2026-10-10' })
      const todayLate = insert({ kind: 'day', date: TODAY, createdAt: '2026-11-08T10:00:00.000Z' })
      const todayEarly = insert({ kind: 'day', date: TODAY, createdAt: '2026-11-08T09:00:00.000Z' })
      const tomorrow = insert({ kind: 'day', date: '2026-11-10', createdAt: '2026-11-01T09:00:00.000Z' })
      const yesterday = insert({ kind: 'day', date: '2026-11-08' })
      const lastMonth = insert({ kind: 'day', date: '2026-10-15' })
      const list = listNotes(db, leitung, { group: 'all' }, TODAY)
      expect(ids(list.board)).toEqual([boardNew, boardLater, boardOld])
      expect(ids(list.expired)).toEqual([expiredNew, expiredOld])
      expect(ids(list.upcoming)).toEqual([todayEarly, todayLate, tomorrow])
      expect(ids(list.past)).toEqual([yesterday, lastMonth])
      expect(list.pastHasOlder).toBe(false)
    })

    it('shows past days of the last 12 months; older ones on request (olderPast)', () => {
      const recent = insert({ kind: 'day', date: '2025-11-09' })
      const older = insert({ kind: 'day', date: '2025-11-08' })
      const list = listNotes(db, leitung, { group: 'all' }, TODAY)
      expect(ids(list.past)).toEqual([recent])
      expect(list.pastHasOlder).toBe(true)
      const all = listNotes(db, leitung, { group: 'all', olderPast: true }, TODAY)
      expect(ids(all.past)).toEqual([recent, older])
      expect(all.pastHasOlder).toBe(false)
    })

    it('filters: „facility“ only the whole facility, a group its notes and those of the facility', () => {
      const facilityNote = insert({ kind: 'board', createdAt: '2026-11-01T08:00:00.000Z' })
      const baerenNote = insert({ kind: 'board', groupId: baeren, createdAt: '2026-11-02T08:00:00.000Z' })
      const fuechseNote = insert({ kind: 'board', groupId: fuechse, createdAt: '2026-11-03T08:00:00.000Z' })
      const baerenDay = insert({ kind: 'day', groupId: baeren, date: '2026-11-10' })
      const fuechseOld = insert({ kind: 'day', groupId: fuechse, date: '2024-01-01' })
      expect(ids(listNotes(db, leitung, { group: 'all' }, TODAY).board)).toEqual([fuechseNote, baerenNote, facilityNote])
      const facilityOnly = listNotes(db, leitung, { group: 'facility' }, TODAY)
      expect(ids(facilityOnly.board)).toEqual([facilityNote])
      expect(facilityOnly.upcoming).toEqual([])
      expect(facilityOnly.pastHasOlder).toBe(false)
      const baerenList = listNotes(db, leitung, { group: baeren }, TODAY)
      expect(ids(baerenList.board)).toEqual([baerenNote, facilityNote])
      expect(ids(baerenList.upcoming)).toEqual([baerenDay])
      expect(baerenList.pastHasOlder).toBe(false)
      expect(listNotes(db, leitung, { group: fuechse }, TODAY).pastHasOlder).toBe(true)
      expect(fuechseOld).toBeGreaterThan(0)
    })

    it('a group of another facility as filter is 404 group_not_found', () => {
      expect(failure(() => listNotes(db, leitung, { group: eulenB }, TODAY))).toBe('404 group_not_found')
      expect(failure(() => listNotes(db, tablet, { group: 99999 }, TODAY))).toBe('404 group_not_found')
    })
  })

  describe('schemas', () => {
    it('parses the note input and the list query', () => {
      expect(noteInputSchema.parse(board())).toEqual(board())
      expect(() => noteInputSchema.parse({ ...board(), kind: 'other' })).toThrow()
      expect(() => noteInputSchema.parse({ ...board(), text: 'x'.repeat(5001) })).toThrow()
      expect(notesQuery.parse({})).toEqual({ group: 'all', older: false })
      expect(notesQuery.parse({ group: 'facility', older: '1' })).toEqual({ group: 'facility', older: true })
      expect(notesQuery.parse({ group: '7', older: 'true' })).toEqual({ group: 7, older: true })
      expect(notesQuery.parse({ group: '', older: 'false' })).toEqual({ group: 'all', older: false })
      expect(() => notesQuery.parse({ group: 'x' })).toThrow()
    })
  })
})
