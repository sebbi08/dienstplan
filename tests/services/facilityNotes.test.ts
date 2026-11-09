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

const note = (more: Partial<NoteInput> = {}): NoteInput => ({ groupId: null, validUntil: null, text: 'Notiz', ...more })

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
  const insert = (values: Partial<typeof facilityNotes.$inferInsert> = {}) =>
    db.insert(facilityNotes).values({
      facilityId: 1, groupId: null, validUntil: null, text: 'x', createdAt: NOW.toISOString(), createdBy: 'Test',
      ...values,
    }).returning({ id: facilityNotes.id }).get().id
  const ids = (notes: { id: number }[]) => notes.map(entry => entry.id)

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
      const facilityNote = createNote(db, leitung, note({ text: '  Elternabend am Freitag  ' }), NOW)
      const groupNote = createNote(db, traeger, note({ groupId: fuechse, text: 'Ausflug' }), LATER)
      const list = listNotes(db, leitung, { group: 'all' }, TODAY)
      expect(list.current).toEqual([
        {
          id: groupNote.id, groupId: fuechse, groupName: 'Füchse', validUntil: null, text: 'Ausflug',
          createdAt: LATER.toISOString(), createdBy: 'traeger', updatedAt: null, updatedBy: null, canEdit: true,
        },
        {
          id: facilityNote.id, groupId: null, groupName: null, validUntil: null, text: 'Elternabend am Freitag',
          createdAt: NOW.toISOString(), createdBy: 'Lea Leitung', updatedAt: null, updatedBy: null, canEdit: true,
        },
      ])
      expect(createNote(db, leitung, note({ groupId: baeren }), NOW).groupId).toBe(baeren)
    })

    it('a Gruppenleitung writes only for her own group (403 forbidden for the facility or another group)', () => {
      const own = createNote(db, gruppenleitung, note({ groupId: baeren }), NOW)
      expect(own).toMatchObject({ groupId: baeren, createdBy: 'Gina', canEdit: true })
      expect(failure(() => createNote(db, gruppenleitung, note({ groupId: fuechse }), NOW))).toBe('403 forbidden')
      expect(failure(() => createNote(db, gruppenleitung, note({ groupId: null }), NOW))).toBe('403 forbidden')
      expect(failure(() => createNote(db, gruppenleitung, note({ groupId: eulenB }), NOW))).toBe('403 forbidden')
    })

    it('a Gruppenleitung changes and deletes only notes of her own group', () => {
      const facilityNote = createNote(db, leitung, note(), NOW).id
      const otherGroup = createNote(db, leitung, note({ groupId: fuechse }), NOW).id
      const own = createNote(db, leitung, note({ groupId: baeren }), NOW).id
      for (const id of [facilityNote, otherGroup]) {
        expect(failure(() => updateNote(db, gruppenleitung, id, note({ groupId: baeren }), LATER))).toBe('403 forbidden')
        expect(failure(() => deleteNote(db, gruppenleitung, id))).toBe('403 forbidden')
      }
      // Moving her own note to the facility or another group is not hers to do either.
      expect(failure(() => updateNote(db, gruppenleitung, own, note({ groupId: null }), LATER))).toBe('403 forbidden')
      expect(failure(() => updateNote(db, gruppenleitung, own, note({ groupId: fuechse }), LATER))).toBe('403 forbidden')
      expect(updateNote(db, gruppenleitung, own, note({ groupId: baeren, text: 'neu' }), LATER).text).toBe('neu')
      deleteNote(db, gruppenleitung, own)
      expect(db.select().from(facilityNotes).where(eq(facilityNotes.id, own)).get()).toBeUndefined()
    })

    it('a Springer-Gruppenleitung without a group has nothing to write (403 notes_no_group)', () => {
      const id = createNote(db, leitung, note(), NOW).id
      expect(failure(() => createNote(db, springer, note({ groupId: baeren }), NOW))).toBe('403 notes_no_group')
      expect(failure(() => createNote(db, springer, note(), NOW))).toBe('403 notes_no_group')
      expect(failure(() => updateNote(db, springer, id, note(), LATER))).toBe('403 notes_no_group')
      expect(failure(() => deleteNote(db, springer, id))).toBe('403 notes_no_group')
      expect(listNotes(db, springer, { group: 'all' }, TODAY).write).toEqual({ facility: false, groupId: null })
    })

    it('without notes.write (Mitarbeiter, tablet) the service refuses (403 forbidden)', () => {
      const id = createNote(db, leitung, note(), NOW).id
      for (const actor of [mitarbeiter, tablet]) {
        expect(failure(() => createNote(db, actor, note({ groupId: baeren }), NOW))).toBe('403 forbidden')
        expect(failure(() => updateNote(db, actor, id, note(), LATER))).toBe('403 forbidden')
        expect(failure(() => deleteNote(db, actor, id))).toBe('403 forbidden')
      }
    })

    it('a Mitarbeiter with the exception „schreiben“ (own group) writes for her group only', () => {
      saveBundleOverride(db, mitarbeiter.id, 'notesWrite', 'grant', 'group')
      // The rights are read when the session user is loaded (the next request).
      const mia = asActor(getActiveUser(db, mitarbeiter.id, TODAY)!)
      expect(listNotes(db, mia, { group: 'all' }, TODAY).write).toEqual({ facility: false, groupId: baeren })
      expect(createNote(db, mia, note({ groupId: baeren }), NOW).createdBy).toBe('Mia')
      expect(failure(() => createNote(db, mia, note(), NOW))).toBe('403 forbidden')
    })

    it('keeps who changed a note and when', () => {
      const id = createNote(db, leitung, note(), NOW).id
      const changed = updateNote(db, traeger, id, note({ text: 'Geändert', validUntil: '2026-12-01' }), LATER)
      expect(changed).toMatchObject({
        text: 'Geändert', validUntil: '2026-12-01', createdBy: 'Lea Leitung', createdAt: NOW.toISOString(),
        updatedBy: 'traeger', updatedAt: LATER.toISOString(),
      })
    })

    it('checks the text (trimmed 1–1000 chars)', () => {
      expect(failure(() => createNote(db, leitung, note({ text: '   ' }), NOW))).toBe('400 note_text_invalid')
      expect(failure(() => createNote(db, leitung, note({ text: 'x'.repeat(1001) }), NOW))).toBe('400 note_text_invalid')
      expect(createNote(db, leitung, note({ text: ` ${'x'.repeat(1000)} ` }), NOW).text).toHaveLength(1000)
      const id = createNote(db, leitung, note(), NOW).id
      expect(failure(() => updateNote(db, leitung, id, note({ text: '' }), LATER))).toBe('400 note_text_invalid')
    })

    it('„gilt bis“ is optional: a valid date, on create not before today, on a change any date', () => {
      expect(failure(() => createNote(db, leitung, note({ validUntil: '2026-11-08' }), NOW))).toBe('400 note_valid_until_invalid')
      expect(failure(() => createNote(db, leitung, note({ validUntil: '2026-13-01' }), NOW))).toBe('400 note_valid_until_invalid')
      expect(createNote(db, leitung, note({ validUntil: TODAY }), NOW).validUntil).toBe(TODAY)
      expect(createNote(db, leitung, note({ validUntil: '' }), NOW).validUntil).toBeNull()
      // On a change, an expired „gilt bis“ may stay.
      const id = insert({ validUntil: '2026-11-01' })
      expect(updateNote(db, leitung, id, note({ validUntil: '2026-11-01', text: 'neu' }), LATER).validUntil).toBe('2026-11-01')
      expect(updateNote(db, leitung, id, note({ validUntil: null, text: 'neu' }), LATER).validUntil).toBeNull()
      expect(failure(() => updateNote(db, leitung, id, note({ validUntil: 'gestern' }), LATER))).toBe('400 note_valid_until_invalid')
    })

    it('another facility: its group 404 group_not_found, its note 404 note_not_found', () => {
      expect(failure(() => createNote(db, leitung, note({ groupId: eulenB }), NOW))).toBe('404 group_not_found')
      expect(failure(() => createNote(db, leitung, note({ groupId: 99999 }), NOW))).toBe('404 group_not_found')
      const id = createNote(db, leitung, note(), NOW).id
      expect(failure(() => updateNote(db, leitungB, id, note(), LATER))).toBe('404 note_not_found')
      expect(failure(() => deleteNote(db, leitungB, id))).toBe('404 note_not_found')
      expect(failure(() => updateNote(db, leitung, 99999, note(), LATER))).toBe('404 note_not_found')
      const own = createNote(db, leitung, note({ groupId: baeren }), NOW).id
      expect(failure(() => updateNote(db, leitung, own, note({ groupId: eulenB }), LATER))).toBe('404 group_not_found')
      expect(listNotes(db, leitungB, { group: 'all' }, TODAY).current).toEqual([])
    })

    it('deleting a group turns its notes into notes of the whole facility', () => {
      const id = createNote(db, leitung, note({ groupId: fuechse }), NOW).id
      deleteGroup(db, 1, fuechse, TODAY)
      expect(listNotes(db, leitung, { group: 'facility' }, TODAY).current).toMatchObject([{ id, groupId: null, groupName: null }])
    })
  })

  describe('reading', () => {
    it('every role of the facility and the tablet read all notes; write only with notes.write', () => {
      const facilityNote = createNote(db, leitung, note(), NOW).id
      const groupNote = createNote(db, leitung, note({ groupId: fuechse }), NOW).id
      for (const actor of [leitung, traeger, gruppenleitung, springer, mitarbeiter, tablet]) {
        expect(ids(listNotes(db, actor, { group: 'all' }, TODAY).current).sort()).toEqual([facilityNote, groupNote].sort())
      }
      expect(listNotes(db, leitung, { group: 'all' }, TODAY).write).toEqual({ facility: true, groupId: null })
      expect(listNotes(db, traeger, { group: 'all' }, TODAY).write).toEqual({ facility: true, groupId: null })
      expect(listNotes(db, gruppenleitung, { group: 'all' }, TODAY).write).toEqual({ facility: false, groupId: baeren })
      expect(listNotes(db, mitarbeiter, { group: 'all' }, TODAY).write).toBeNull()
      expect(listNotes(db, tablet, { group: 'all' }, TODAY).write).toBeNull()
    })

    it('marks per note whether the reader may change it', () => {
      const facilityNote = createNote(db, leitung, note(), NOW).id
      const own = createNote(db, leitung, note({ groupId: baeren }), NOW).id
      const other = createNote(db, leitung, note({ groupId: fuechse }), NOW).id
      const canEdit = (actor: NotesActor) => Object.fromEntries(
        listNotes(db, actor, { group: 'all' }, TODAY).current.map(entry => [entry.id, entry.canEdit]),
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

    it('splits current/expired, each newest first; „gilt bis“ today still applies', () => {
      const old = insert({ createdAt: '2026-11-01T08:00:00.000Z' })
      const newest = insert({ createdAt: '2026-11-05T08:00:00.000Z', validUntil: TODAY })
      const later = insert({ createdAt: '2026-11-03T08:00:00.000Z', validUntil: '2026-12-31' })
      const expiredOld = insert({ createdAt: '2026-10-01T08:00:00.000Z', validUntil: '2026-11-08' })
      const expiredNew = insert({ createdAt: '2026-10-05T08:00:00.000Z', validUntil: '2026-10-10' })
      const list = listNotes(db, leitung, { group: 'all' }, TODAY)
      expect(ids(list.current)).toEqual([newest, later, old])
      expect(ids(list.expired)).toEqual([expiredNew, expiredOld])
      expect(Object.keys(list).sort()).toEqual(['current', 'expired', 'groups', 'write'])
      expect(Object.keys(list.current[0]!)).not.toContain('kind')
      expect(Object.keys(list.current[0]!)).not.toContain('date')
    })

    it('filters: „facility“ only the whole facility, a group its notes and those of the facility', () => {
      const facilityNote = insert({ createdAt: '2026-11-01T08:00:00.000Z' })
      const baerenNote = insert({ groupId: baeren, createdAt: '2026-11-02T08:00:00.000Z' })
      const fuechseNote = insert({ groupId: fuechse, createdAt: '2026-11-03T08:00:00.000Z' })
      const baerenExpired = insert({ groupId: baeren, validUntil: '2026-11-01' })
      expect(ids(listNotes(db, leitung, { group: 'all' }, TODAY).current)).toEqual([fuechseNote, baerenNote, facilityNote])
      const facilityOnly = listNotes(db, leitung, { group: 'facility' }, TODAY)
      expect(ids(facilityOnly.current)).toEqual([facilityNote])
      expect(facilityOnly.expired).toEqual([])
      const baerenList = listNotes(db, leitung, { group: baeren }, TODAY)
      expect(ids(baerenList.current)).toEqual([baerenNote, facilityNote])
      expect(ids(baerenList.expired)).toEqual([baerenExpired])
    })

    it('a group of another facility as filter is 404 group_not_found', () => {
      expect(failure(() => listNotes(db, leitung, { group: eulenB }, TODAY))).toBe('404 group_not_found')
      expect(failure(() => listNotes(db, tablet, { group: 99999 }, TODAY))).toBe('404 group_not_found')
    })
  })

  describe('search', () => {
    const search = (q: string, group: Parameters<typeof listNotes>[2]['group'] = 'all') => {
      const list = listNotes(db, leitung, { group, q }, TODAY)
      return { current: ids(list.current), expired: ids(list.expired) }
    }

    it('finds the text, case-insensitive with umlauts', () => {
      const baerenNote = insert({ text: 'Die Bären gehen in den Wald.' })
      const other = insert({ text: 'Elternabend' })
      expect(search('bären')).toEqual({ current: [baerenNote], expired: [] })
      expect(search('BÄREN')).toEqual({ current: [baerenNote], expired: [] })
      expect(search('Bären')).toEqual({ current: [baerenNote], expired: [] })
      expect(search('baeren')).toEqual({ current: [], expired: [] })
      expect(search('ELTERN')).toEqual({ current: [other], expired: [] })
      // „Bären“ typed with a combining umlaut still matches.
      expect(search('bären')).toEqual({ current: [baerenNote], expired: [] })
    })

    it('finds the author and whoever changed it', () => {
      const byLea = insert({ text: 'eins', createdBy: 'Lea Leitung' })
      const changedByGina = insert({ text: 'zwei', createdBy: 'Test', updatedBy: 'Gina Groß', updatedAt: NOW.toISOString() })
      insert({ text: 'drei', createdBy: 'Test' })
      expect(search('lea')).toEqual({ current: [byLea], expired: [] })
      expect(search('groß')).toEqual({ current: [changedByGina], expired: [] })
    })

    it('needs every word, each in the text or a name', () => {
      const both = insert({ text: 'Ausflug in den Wald', createdBy: 'Lea Leitung', createdAt: '2026-11-02T08:00:00.000Z' })
      const onlyWald = insert({ text: 'Wald putzen', createdBy: 'Gina', createdAt: '2026-11-01T08:00:00.000Z' })
      expect(search('wald')).toEqual({ current: [both, onlyWald], expired: [] })
      expect(search('  wald   ausflug ')).toEqual({ current: [both], expired: [] })
      expect(search('wald lea')).toEqual({ current: [both], expired: [] })
      expect(search('wald zoo')).toEqual({ current: [], expired: [] })
    })

    it('searches the expired notes too and keeps the group filter', () => {
      const facilityNote = insert({ text: 'Laternenfest' })
      const baerenExpired = insert({ groupId: baeren, text: 'Laternen basteln', validUntil: '2026-11-01' })
      const fuechseNote = insert({ groupId: fuechse, text: 'Laternen kaufen' })
      expect(search('laterne')).toEqual({ current: [fuechseNote, facilityNote], expired: [baerenExpired] })
      expect(search('laterne', baeren)).toEqual({ current: [facilityNote], expired: [baerenExpired] })
      expect(search('laterne', 'facility')).toEqual({ current: [facilityNote], expired: [] })
    })

    it('an empty or blank q lists every note', () => {
      const first = insert({ text: 'eins', createdAt: '2026-11-01T08:00:00.000Z' })
      const second = insert({ text: 'zwei', createdAt: '2026-11-02T08:00:00.000Z' })
      expect(search('')).toEqual({ current: [second, first], expired: [] })
      expect(search('   ')).toEqual({ current: [second, first], expired: [] })
      expect(ids(listNotes(db, leitung, { group: 'all' }, TODAY).current)).toEqual([second, first])
    })
  })

  describe('schemas', () => {
    it('parses the note input and the list query', () => {
      expect(noteInputSchema.parse(note())).toEqual(note())
      // Fields of the former day notes are dropped.
      expect(noteInputSchema.parse({ ...note(), kind: 'day', date: '2026-11-09' })).toEqual(note())
      expect(() => noteInputSchema.parse({ ...note(), text: 'x'.repeat(5001) })).toThrow()
      expect(notesQuery.parse({})).toEqual({ group: 'all', q: '' })
      expect(notesQuery.parse({ group: 'facility', q: '  Bären  ' })).toEqual({ group: 'facility', q: 'Bären' })
      expect(notesQuery.parse({ group: '7' })).toEqual({ group: 7, q: '' })
      expect(notesQuery.parse({ group: '', q: '' })).toEqual({ group: 'all', q: '' })
      expect(notesQuery.parse({ q: `  ${'x'.repeat(100)}  ` })).toEqual({ group: 'all', q: 'x'.repeat(100) })
      expect(() => notesQuery.parse({ q: 'x'.repeat(101) })).toThrow()
      expect(() => notesQuery.parse({ group: 'x' })).toThrow()
    })
  })
})
