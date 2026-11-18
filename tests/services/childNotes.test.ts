import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childNotes, children, employees, users } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { addNote, deleteNote, notesOf, updateNote } from '../../server/services/childNotes'
import { deleteChild, getChild } from '../../server/services/children'
import { setReadAccess } from '../../server/services/groupReadAccess'
import type { ChildNoteInput } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-10-20'
const NOW = new Date('2026-10-20T08:00:00Z')
const LATER = new Date('2026-10-21T09:30:00Z')

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

describe('child notes', () => {
  let db: Db
  let a: number
  let b: number
  let c: number
  let kidA: number
  let kidB: number
  let kidC: number
  let anna: number
  let annaUser: number
  let berta: number
  let leitung: ChildViewer
  /** Anna at the tablet with her Mitarbeiter account (no „Akten ändern“): own group A, B readable, C hidden. */
  let staff: ChildViewer
  /** Berta at the tablet without an account. */
  let reader: ChildViewer

  const input = (overrides: Partial<ChildNoteInput> = {}): ChildNoteInput => ({
    date: '2026-10-19', text: 'Hat heute zum ersten Mal allein gegessen.', educatorEmployeeId: anna, ...overrides,
  })

  beforeEach(() => {
    db = createTestDb()
    a = addGroup(db, 1, 'Bären')
    b = addGroup(db, 1, 'Mäuse')
    c = addGroup(db, 1, 'Füchse')
    setReadAccess(db, 1, a, [b])
    anna = addEmployee(db, 'Anna', { groupId: a })
    annaUser = addUser(db, 'anna', 'observer', anna).id
    berta = addEmployee(db, 'Berta', { groupId: a })
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    const tablet = { visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: a, readable: [b] } }
    staff = {
      id: annaUser, employeeId: anna, name: 'Anna', role: 'observer', permissions: permissionsOf('observer'), facilityId: 1, ...tablet,
    }
    reader = {
      id: null, employeeId: berta, name: 'Berta', role: 'observer', permissions: permissionsOf('observer'), facilityId: 1, ...tablet,
    }
    kidA = addChild(db, 1, { firstName: 'Lena', groupId: a })
    kidB = addChild(db, 1, { firstName: 'Max', groupId: b })
    kidC = addChild(db, 1, { firstName: 'Ida', groupId: c })
  })

  describe('entering', () => {
    it('stores the trimmed note with educator and author and lists it for the record', () => {
      const id = addNote(db, staff, kidA, input({ text: '  Hat heute zum ersten Mal allein gegessen.  ' }), NOW)
      expect(notesOf(db, staff, kidA, TODAY)).toEqual([{
        id, date: '2026-10-19', text: 'Hat heute zum ersten Mal allein gegessen.', educatorEmployeeId: anna, educatorName: 'Anna',
        createdByName: 'Anna', createdAt: NOW.toISOString(), updatedByName: null, updatedAt: null, canEdit: true,
      }])
      expect(db.select({
        userId: childNotes.createdByUserId, employeeId: childNotes.createdByEmployeeId, educatorName: childNotes.educatorName,
      }).from(childNotes).where(eq(childNotes.id, id)).get()).toEqual({ userId: annaUser, employeeId: anna, educatorName: 'Anna' })
    })

    it('lists the newest date first, then the newest entered', () => {
      const first = addNote(db, leitung, kidA, input({ date: '2026-10-01' }), NOW)
      const second = addNote(db, leitung, kidA, input({ date: '2026-10-15' }), NOW)
      const third = addNote(db, leitung, kidA, input({ date: '2026-10-01' }), NOW)
      const fourth = addNote(db, leitung, kidA, input({ date: '2025-12-24' }), NOW)
      expect(notesOf(db, leitung, kidA, TODAY).map(note => note.id)).toEqual([second, third, first, fourth])
    })

    it('accepts a note without educator', () => {
      addNote(db, leitung, kidA, input({ educatorEmployeeId: null }), NOW)
      expect(notesOf(db, leitung, kidA, TODAY).map(note => [note.educatorEmployeeId, note.educatorName])).toEqual([[null, '']])
    })

    it('checks the date, the text (1–2000 characters after trimming) and the educator', () => {
      const add = (overrides: Partial<ChildNoteInput>) => failure(() => addNote(db, leitung, kidA, input(overrides), NOW))
      expect(add({ date: '2026-02-30' })).toBe('400 invalid_date')
      expect(add({ text: '' })).toBe('400 child_note_text_invalid')
      expect(add({ text: '   \n ' })).toBe('400 child_note_text_invalid')
      expect(add({ text: 'x'.repeat(2001) })).toBe('400 child_note_text_invalid')
      const otherFacility = addEmployee(db, 'Fremd', { facilityId: addFacility(db, 'Krippe') })
      const left = addEmployee(db, 'Gegangen', { leftOn: '2026-09-30' })
      expect(add({ educatorEmployeeId: otherFacility })).toBe('400 child_note_educator_invalid')
      expect(add({ educatorEmployeeId: left })).toBe('400 child_note_educator_invalid')
      expect(add({ educatorEmployeeId: 9999 })).toBe('400 child_note_educator_invalid')
      expect(add({ text: ` ${'x'.repeat(2000)} ` })).toBeNull()
      // Leaving today: still on the staff list today.
      expect(add({ educatorEmployeeId: addEmployee(db, 'Letzter Tag', { leftOn: TODAY }) })).toBeNull()
      expect(db.select().from(childNotes).all()).toHaveLength(2)
    })
  })

  describe('rights', () => {
    it('lets every staff member who sees the child add a note, without „Akten ändern“: own and readable group', () => {
      addNote(db, staff, kidA, input(), NOW)
      addNote(db, staff, kidB, input(), NOW)
      expect(getChild(db, staff, kidA, TODAY, NOW).canAddNotes).toBe(true)
      expect(getChild(db, staff, kidB, TODAY, NOW).canAddNotes).toBe(true)
      expect(getChild(db, staff, kidB, TODAY, NOW).canEdit).toBe(false)
    })

    it('hides the child of a group the person does not see (404) and its notes', () => {
      const id = addNote(db, leitung, kidC, input(), NOW)
      expect(failure(() => addNote(db, staff, kidC, input(), NOW))).toBe('404 child_not_found')
      expect(failure(() => updateNote(db, staff, id, input(), NOW))).toBe('404 child_note_not_found')
      expect(failure(() => deleteNote(db, staff, id, NOW))).toBe('404 child_note_not_found')
    })

    it('lets the person who unlocked the tablet add a note even without an account, and change it as author', () => {
      const id = addNote(db, reader, kidA, input({ educatorEmployeeId: berta }), NOW)
      expect(db.select({ userId: childNotes.createdByUserId, employeeId: childNotes.createdByEmployeeId, name: childNotes.createdByName })
        .from(childNotes).get()).toEqual({ userId: null, employeeId: berta, name: 'Berta' })
      updateNote(db, reader, id, input({ text: 'Korrigiert', educatorEmployeeId: berta }), LATER)
      expect(notesOf(db, reader, kidA, TODAY)[0]).toMatchObject({ text: 'Korrigiert', updatedByName: 'Berta', updatedAt: LATER.toISOString(), canEdit: true })
      deleteNote(db, reader, id, LATER)
      expect(db.select().from(childNotes).all()).toEqual([])
    })

    it('lets the author change and delete the own note, nobody else but Leitung and Träger', () => {
      const id = addNote(db, staff, kidA, input(), NOW)
      expect(notesOf(db, reader, kidA, TODAY)[0]!.canEdit).toBe(false)
      expect(failure(() => updateNote(db, reader, id, input({ text: 'Fremd' }), NOW))).toBe('403 child_note_author_only')
      expect(failure(() => deleteNote(db, reader, id, NOW))).toBe('403 child_note_author_only')
      // The same person with the own account at the office is the author as well.
      const annaOffice: ChildViewer = { ...staff, onTablet: false }
      updateNote(db, annaOffice, id, input({ text: 'Geändert von Anna' }), LATER)
      expect(notesOf(db, staff, kidA, TODAY)[0]).toMatchObject({ text: 'Geändert von Anna', updatedByName: 'Anna', canEdit: true })
      expect(db.select().from(childNotes).all()).toHaveLength(1)
    })

    it('recognizes the author by the unlocking employee when the account is gone', () => {
      const id = addNote(db, staff, kidA, input(), NOW)
      db.delete(users).where(eq(users.id, annaUser)).run()
      const annaWithoutAccount: ChildViewer = { ...staff, id: null }
      expect(notesOf(db, annaWithoutAccount, kidA, TODAY)[0]!.canEdit).toBe(true)
      deleteNote(db, annaWithoutAccount, id, NOW)
      expect(db.select().from(childNotes).all()).toEqual([])
    })

    it('lets Leitung and Träger change and delete every note', () => {
      const first = addNote(db, staff, kidA, input(), NOW)
      const second = addNote(db, reader, kidA, input({ educatorEmployeeId: berta }), NOW)
      expect(notesOf(db, leitung, kidA, TODAY).map(note => note.canEdit)).toEqual([true, true])
      updateNote(db, leitung, first, input({ text: 'Von der Leitung', educatorEmployeeId: berta }), LATER)
      expect(notesOf(db, leitung, kidA, TODAY).find(note => note.id === first))
        .toMatchObject({ text: 'Von der Leitung', educatorEmployeeId: berta, educatorName: 'Berta', createdByName: 'Anna', updatedByName: 'leitung' })
      deleteNote(db, leitung, first, LATER)
      const provider = asChildViewer(addUser(db, 'traeger', 'provider'))
      deleteNote(db, provider, second, LATER)
      expect(db.select().from(childNotes).all()).toEqual([])
    })

    it('answers 404 child_note_not_found for an unknown note and one of another facility', () => {
      const second = addFacility(db, 'Krippe')
      const other = addChild(db, second, { firstName: 'Fremd' })
      const id = addNote(db, asChildViewer(addUser(db, 'leitung2', 'admin', null, second), second), other, input({ educatorEmployeeId: null }), NOW)
      expect(failure(() => updateNote(db, leitung, id, input(), NOW))).toBe('404 child_note_not_found')
      expect(failure(() => deleteNote(db, leitung, id, NOW))).toBe('404 child_note_not_found')
      expect(failure(() => updateNote(db, leitung, 9999, input(), NOW))).toBe('404 child_note_not_found')
      expect(failure(() => addNote(db, leitung, other, input(), NOW))).toBe('404 child_not_found')
    })

    it('keeps the notes of an archived child: Leitung reads them, nobody adds or changes them', () => {
      const id = addNote(db, leitung, kidA, input(), NOW)
      db.update(children).set({ leftOn: '2026-10-01' }).where(eq(children.id, kidA)).run()
      const record = getChild(db, leitung, kidA, TODAY, NOW)
      expect(record.notes.map(note => [note.id, note.canEdit])).toEqual([[id, false]])
      expect(record.canAddNotes).toBe(false)
      expect(failure(() => addNote(db, leitung, kidA, input(), NOW))).toBe('409 child_archived')
      expect(failure(() => updateNote(db, leitung, id, input(), NOW))).toBe('409 child_archived')
      expect(failure(() => deleteNote(db, leitung, id, NOW))).toBe('409 child_archived')
      expect(failure(() => addNote(db, staff, kidA, input(), NOW))).toBe('404 child_not_found')
      expect(failure(() => updateNote(db, staff, id, input(), NOW))).toBe('404 child_note_not_found')
    })
  })

  describe('the educator', () => {
    it('keeps an educator who has left since when the note is changed, but refuses choosing one', () => {
      const id = addNote(db, leitung, kidA, input({ educatorEmployeeId: berta }), NOW)
      db.update(employees).set({ leftOn: '2026-10-15' }).where(eq(employees.id, berta)).run()
      updateNote(db, leitung, id, input({ text: 'Neu', educatorEmployeeId: berta }), LATER)
      expect(notesOf(db, leitung, kidA, TODAY)[0]).toMatchObject({ text: 'Neu', educatorEmployeeId: berta, educatorName: 'Berta' })
      const other = addNote(db, leitung, kidA, input(), NOW)
      expect(failure(() => updateNote(db, leitung, other, input({ educatorEmployeeId: berta }), LATER))).toBe('400 child_note_educator_invalid')
    })

    it('shows the saved name once the employee is deleted', () => {
      addNote(db, leitung, kidA, input({ educatorEmployeeId: berta }), NOW)
      db.delete(employees).where(eq(employees.id, berta)).run()
      expect(notesOf(db, leitung, kidA, TODAY)[0]).toMatchObject({ educatorEmployeeId: null, educatorName: 'Berta' })
    })

    it('starts a new note with the acting person: the unlocking employee, the account\'s employee, else none', () => {
      expect(getChild(db, staff, kidA, TODAY, NOW).noteEducatorId).toBe(anna)
      expect(getChild(db, reader, kidA, TODAY, NOW).noteEducatorId).toBe(berta)
      expect(getChild(db, leitung, kidA, TODAY, NOW).noteEducatorId).toBeNull()
      const carla = addEmployee(db, 'Carla')
      const leitungCarla = asChildViewer(addUser(db, 'carla', 'admin', carla))
      expect(getChild(db, leitungCarla, kidA, TODAY, NOW).noteEducatorId).toBe(carla)
      // A helper from another facility is not on this facility's staff list.
      const helper = addEmployee(db, 'Hilfe', { facilityId: addFacility(db, 'Krippe') })
      expect(getChild(db, { ...reader, employeeId: helper }, kidA, TODAY, NOW).noteEducatorId).toBeNull()
    })
  })

  it('goes with the child when the record is deleted', () => {
    addNote(db, leitung, kidA, input(), NOW)
    const kept = addNote(db, leitung, kidB, input(), NOW)
    deleteChild(db, 1, kidA)
    expect(db.select({ id: childNotes.id }).from(childNotes).all()).toEqual([{ id: kept }])
  })

  it('is part of the record for everyone who reads it', () => {
    const id = addNote(db, staff, kidB, input(), NOW)
    expect(getChild(db, reader, kidB, TODAY, NOW).notes.map(note => note.id)).toEqual([id])
    expect(getChild(db, leitung, kidB, TODAY, NOW).notes.map(note => note.id)).toEqual([id])
  })
})
