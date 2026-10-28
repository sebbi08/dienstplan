import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childParentMeetings, children, employees, users } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { deleteChild, getChild } from '../../server/services/children'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { addMeeting, deleteMeeting, meetingsOf, updateMeeting } from '../../server/services/parentMeetings'
import type { ParentMeetingInput } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, allowChildEditing, asChildViewer, createTestDb, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-10-20'
/** 13:59 in Berlin (summer time, UTC+2). */
const AT_1359 = new Date('2026-10-20T11:59:00Z')
/** 14:01 in Berlin. */
const AT_1401 = new Date('2026-10-20T12:01:00Z')
const NOW = new Date('2026-10-20T08:00:00Z')

const input = (overrides: Partial<ParentMeetingInput> = {}): ParentMeetingInput => ({
  date: '2026-10-01', start: 600, end: 660, kind: 'development', participants: 'Mutter, Anna', ...overrides,
})

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

describe('parent meetings', () => {
  let db: Db
  let a: number
  let b: number
  let c: number
  let kidA: number
  let kidB: number
  let kidC: number
  let anna: number
  let annaUser: number
  let leitung: ChildViewer
  /** Anna at the tablet with her account: own group A, B readable, C hidden, may edit children. */
  let staff: ChildViewer
  /** Berta at the tablet without an account: reads only. */
  let reader: ChildViewer

  beforeEach(() => {
    db = createTestDb()
    a = addGroup(db, 1, 'Bären')
    b = addGroup(db, 1, 'Mäuse')
    c = addGroup(db, 1, 'Füchse')
    setReadAccess(db, 1, a, [b])
    anna = addEmployee(db, 'Anna', { groupId: a })
    annaUser = addUser(db, 'anna', 'observer', anna).id
    allowChildEditing(db, annaUser)
    const berta = addEmployee(db, 'Berta', { groupId: a })
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    const tablet = { visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: a, readable: [b] } }
    staff = {
      id: annaUser, employeeId: anna, name: 'Anna', role: 'observer', canEditChildren: true, permissions: permissionsOf('observer', true),
      facilityId: 1, ...tablet,
    }
    reader = {
      id: null, employeeId: berta, name: 'Berta', role: 'observer', canEditChildren: false, permissions: permissionsOf('observer'),
      facilityId: 1, ...tablet,
    }
    kidA = addChild(db, 1, { firstName: 'Lena', groupId: a })
    kidB = addChild(db, 1, { firstName: 'Max', groupId: b })
    kidC = addChild(db, 1, { firstName: 'Ida', groupId: c })
  })

  describe('entering', () => {
    it('stores the meeting with who entered it and lists it for the record', () => {
      const id = addMeeting(db, staff, kidA, input({ participants: '  Mutter, Anna  ' }), NOW)
      expect(meetingsOf(db, staff, kidA, NOW)).toEqual([{
        id, date: '2026-10-01', start: 600, end: 660, kind: 'development', participants: 'Mutter, Anna', planned: false,
        createdByName: 'Anna', createdAt: NOW.toISOString(), updatedByName: null, updatedAt: null, formId: null,
      }])
      expect(db.select({ userId: childParentMeetings.createdByUserId, employeeId: childParentMeetings.createdByEmployeeId })
        .from(childParentMeetings).where(eq(childParentMeetings.id, id)).get()).toEqual({ userId: annaUser, employeeId: anna })
    })

    it('accepts a meeting without end and every kind', () => {
      for (const kind of ['development', 'settling_in', 'final', 'other'] as const) {
        addMeeting(db, leitung, kidA, input({ kind, end: null }), NOW)
      }
      expect(meetingsOf(db, leitung, kidA, NOW).map(meeting => [meeting.kind, meeting.end]).sort()).toEqual([
        ['development', null], ['final', null], ['other', null], ['settling_in', null],
      ])
    })

    it('lists the newest first, by date and start', () => {
      addMeeting(db, leitung, kidA, input({ date: '2026-09-01', start: 900, end: null }), NOW)
      addMeeting(db, leitung, kidA, input({ date: '2026-10-01', start: 600, end: null }), NOW)
      addMeeting(db, leitung, kidA, input({ date: '2026-10-01', start: 840, end: null }), NOW)
      addMeeting(db, leitung, kidA, input({ date: '2025-12-24', start: 480, end: null }), NOW)
      expect(meetingsOf(db, leitung, kidA, NOW).map(meeting => `${meeting.date} ${meeting.start}`)).toEqual([
        '2026-10-01 840', '2026-10-01 600', '2026-09-01 900', '2025-12-24 480',
      ])
    })

    it('checks date, times, kind and text lengths', () => {
      const add = (overrides: Partial<ParentMeetingInput>) => failure(() => addMeeting(db, leitung, kidA, input(overrides), NOW))
      expect(add({ date: '2026-02-30' })).toBe('400 invalid_date')
      expect(add({ start: 1440 })).toBe('400 invalid_time')
      expect(add({ start: -1 })).toBe('400 invalid_time')
      expect(add({ start: 600.5 })).toBe('400 invalid_time')
      expect(add({ end: 1440 })).toBe('400 invalid_time')
      expect(add({ start: 600, end: 600 })).toBe('400 meeting_end_invalid')
      expect(add({ start: 600, end: 590 })).toBe('400 meeting_end_invalid')
      expect(add({ kind: 'parents' as ParentMeetingInput['kind'] })).toBe('400 meeting_kind_invalid')
      expect(add({ participants: 'x'.repeat(201) })).toBe('400 meeting_text_too_long')
      expect(add({ note: 'x'.repeat(2001) })).toBe('400 meeting_text_too_long')
      expect(add({ participants: ` ${'x'.repeat(200)} `, note: ` ${'x'.repeat(2000)} ` })).toBeNull()
      expect(db.select().from(childParentMeetings).all()).toHaveLength(1)
    })
  })

  describe('rights', () => {
    it('lets staff enter, change and delete in the own group and without group', () => {
      const kidNone = addChild(db, 1, { firstName: 'Ohne', groupId: null })
      for (const kid of [kidA, kidNone]) {
        const id = addMeeting(db, staff, kid, input(), NOW)
        updateMeeting(db, staff, id, input({ kind: 'other' }), NOW)
        deleteMeeting(db, staff, id, NOW)
      }
      expect(db.select().from(childParentMeetings).all()).toEqual([])
    })

    it('shows the meetings of a read-only granted group without note, and refuses every change there (403)', () => {
      const id = addMeeting(db, leitung, kidB, input({ note: 'Vertraulich: Trennung der Eltern' }), NOW)
      const record = getChild(db, staff, kidB, TODAY, NOW)
      expect(record.meetings.map(meeting => meeting.id)).toEqual([id])
      expect('note' in record.meetings[0]!).toBe(false)
      expect(JSON.stringify(record)).not.toContain('Vertraulich')
      expect(record.canEditMeetings).toBe(false)
      expect(failure(() => addMeeting(db, staff, kidB, input(), NOW))).toBe('403 group_read_only')
      expect(failure(() => updateMeeting(db, staff, id, input(), NOW))).toBe('403 group_read_only')
      expect(failure(() => deleteMeeting(db, staff, id, NOW))).toBe('403 group_read_only')
      expect(db.select().from(childParentMeetings).all()).toHaveLength(1)
    })

    it('hides the meetings of another group (404)', () => {
      const id = addMeeting(db, leitung, kidC, input(), NOW)
      expect(failure(() => addMeeting(db, staff, kidC, input(), NOW))).toBe('404 child_not_found')
      expect(failure(() => updateMeeting(db, staff, id, input(), NOW))).toBe('404 meeting_not_found')
      expect(failure(() => deleteMeeting(db, staff, id, NOW))).toBe('404 meeting_not_found')
    })

    it('answers 404 meeting_not_found for an unknown meeting and one of another facility', () => {
      const second = addFacility(db, 'Krippe')
      const other = addChild(db, second, { firstName: 'Fremd' })
      const id = addMeeting(db, asChildViewer(addUser(db, 'leitung2', 'admin', null, second), second), other, input(), NOW)
      expect(failure(() => updateMeeting(db, leitung, id, input(), NOW))).toBe('404 meeting_not_found')
      expect(failure(() => deleteMeeting(db, leitung, id, NOW))).toBe('404 meeting_not_found')
      expect(failure(() => updateMeeting(db, leitung, 9999, input(), NOW))).toBe('404 meeting_not_found')
      expect(failure(() => addMeeting(db, leitung, other, input(), NOW))).toBe('404 child_not_found')
    })

    it('refuses a reader without the permission (403 forbidden) and gives them no edit right', () => {
      const id = addMeeting(db, leitung, kidA, input(), NOW)
      expect(failure(() => addMeeting(db, reader, kidA, input(), NOW))).toBe('403 forbidden')
      expect(failure(() => updateMeeting(db, reader, id, input(), NOW))).toBe('403 forbidden')
      expect(failure(() => deleteMeeting(db, reader, id, NOW))).toBe('403 forbidden')
      expect(getChild(db, reader, kidA, TODAY, NOW).canEditMeetings).toBe(false)
      expect(getChild(db, staff, kidA, TODAY, NOW).canEditMeetings).toBe(true)
      expect(getChild(db, leitung, kidC, TODAY, NOW).canEditMeetings).toBe(true)
    })

    it('keeps the meetings of an archived child: Leitung sees them, nobody changes them (409)', () => {
      const id = addMeeting(db, leitung, kidA, input(), NOW)
      db.update(children).set({ leftOn: '2026-10-01' }).where(eq(children.id, kidA)).run()
      const record = getChild(db, leitung, kidA, TODAY, NOW)
      expect(record.meetings.map(meeting => meeting.id)).toEqual([id])
      expect(record.canEditMeetings).toBe(false)
      expect(failure(() => addMeeting(db, leitung, kidA, input(), NOW))).toBe('409 child_archived')
      expect(failure(() => updateMeeting(db, leitung, id, input(), NOW))).toBe('409 child_archived')
      expect(failure(() => deleteMeeting(db, leitung, id, NOW))).toBe('409 child_archived')
      expect(failure(() => updateMeeting(db, staff, id, input(), NOW))).toBe('404 meeting_not_found')
    })
  })

  describe('the confidential note', () => {
    it('gives Leitung and Träger the note, never staff (Review Focus 1)', () => {
      const id = addMeeting(db, leitung, kidA, input({ note: '  Vertraulich: Sorgerecht  ' }), NOW)
      expect(getChild(db, leitung, kidA, TODAY, NOW).meetings[0]!.note).toBe('Vertraulich: Sorgerecht')
      const provider = asChildViewer(addUser(db, 'traeger', 'provider'))
      expect(meetingsOf(db, provider, kidA, NOW)[0]!.note).toBe('Vertraulich: Sorgerecht')
      const record = getChild(db, staff, kidA, TODAY, NOW)
      expect(record.meetings.map(meeting => meeting.id)).toEqual([id])
      expect('note' in record.meetings[0]!).toBe(false)
      expect(JSON.stringify(record)).not.toContain('Sorgerecht')
      expect(JSON.stringify(getChild(db, reader, kidA, TODAY, NOW))).not.toContain('Sorgerecht')
    })

    it('gives Leitung an empty note when none was entered', () => {
      addMeeting(db, leitung, kidA, input(), NOW)
      addMeeting(db, staff, kidA, input({ date: '2026-09-01' }), NOW)
      expect(meetingsOf(db, leitung, kidA, NOW).map(meeting => meeting.note)).toEqual(['', ''])
    })

    it('refuses a note from staff (403), also an empty one, and stores nothing', () => {
      expect(failure(() => addMeeting(db, staff, kidA, input({ note: 'Heimlich' }), NOW))).toBe('403 meeting_note_managers_only')
      expect(failure(() => addMeeting(db, staff, kidA, input({ note: '' }), NOW))).toBe('403 meeting_note_managers_only')
      expect(db.select().from(childParentMeetings).all()).toEqual([])
      const id = addMeeting(db, leitung, kidA, input({ note: 'Alt' }), NOW)
      expect(failure(() => updateMeeting(db, staff, id, input({ note: 'Neu' }), NOW))).toBe('403 meeting_note_managers_only')
      expect(db.select({ note: childParentMeetings.note }).from(childParentMeetings).get()).toEqual({ note: 'Alt' })
    })

    it('keeps the note when staff change the meeting (Review Focus 2)', () => {
      const id = addMeeting(db, leitung, kidA, input({ note: 'Vertraulich' }), NOW)
      updateMeeting(db, staff, id, input({ participants: 'Vater', kind: 'final' }), NOW)
      const [meeting] = meetingsOf(db, leitung, kidA, NOW)
      expect(meeting).toMatchObject({ participants: 'Vater', kind: 'final', note: 'Vertraulich' })
    })

    it('lets Leitung change and clear the note, and keeps it when Leitung leaves it out', () => {
      const id = addMeeting(db, leitung, kidA, input({ note: 'Erst' }), NOW)
      updateMeeting(db, leitung, id, input({ note: 'Dann' }), NOW)
      expect(meetingsOf(db, leitung, kidA, NOW)[0]!.note).toBe('Dann')
      updateMeeting(db, leitung, id, input({ participants: 'Oma' }), NOW)
      expect(meetingsOf(db, leitung, kidA, NOW)[0]!.note).toBe('Dann')
      updateMeeting(db, leitung, id, input({ note: '  ' }), NOW)
      expect(meetingsOf(db, leitung, kidA, NOW)[0]!.note).toBe('')
    })
  })

  describe('changing', () => {
    it('stores the new values and who changed them, keeping who entered it', () => {
      const id = addMeeting(db, leitung, kidA, input(), NOW)
      const later = new Date('2026-10-20T09:30:00Z')
      updateMeeting(db, staff, id, input({ date: '2026-10-02', start: 615, end: null, kind: 'settling_in', participants: 'Vater' }), later)
      expect(meetingsOf(db, leitung, kidA, later)).toEqual([{
        id, date: '2026-10-02', start: 615, end: null, kind: 'settling_in', participants: 'Vater', note: '', planned: false,
        createdByName: 'leitung', createdAt: NOW.toISOString(), updatedByName: 'Anna', updatedAt: later.toISOString(), formId: null,
      }])
    })

    it('checks the values on a change as well and keeps the stored ones', () => {
      const id = addMeeting(db, leitung, kidA, input(), NOW)
      expect(failure(() => updateMeeting(db, leitung, id, input({ end: 500 }), NOW))).toBe('400 meeting_end_invalid')
      expect(failure(() => updateMeeting(db, leitung, id, input({ kind: 'x' as ParentMeetingInput['kind'] }), NOW)))
        .toBe('400 meeting_kind_invalid')
      expect(meetingsOf(db, leitung, kidA, NOW)[0]).toMatchObject({ end: 660, kind: 'development', updatedAt: null })
    })

    it('keeps the name of who entered and changed it when the account and the employee are gone', () => {
      const id = addMeeting(db, staff, kidA, input(), NOW)
      updateMeeting(db, staff, id, input(), NOW)
      db.delete(users).where(eq(users.id, annaUser)).run()
      db.delete(employees).where(eq(employees.id, anna)).run()
      expect(meetingsOf(db, leitung, kidA, NOW)[0]).toMatchObject({ createdByName: 'Anna', updatedByName: 'Anna' })
      expect(db.select({ userId: childParentMeetings.createdByUserId, employeeId: childParentMeetings.createdByEmployeeId })
        .from(childParentMeetings).get()).toEqual({ userId: null, employeeId: null })
    })
  })

  describe('planned', () => {
    it('is planned in the future and today until it begins (Review Focus 3)', () => {
      addMeeting(db, leitung, kidA, input({ date: TODAY, start: 840, end: 900 }), NOW)
      addMeeting(db, leitung, kidA, input({ date: '2026-10-21', start: 0, end: null }), NOW)
      addMeeting(db, leitung, kidA, input({ date: '2026-10-19', start: 1439, end: null }), NOW)
      const planned = (now: Date) => meetingsOf(db, leitung, kidA, now).map(meeting => `${meeting.date} ${meeting.planned}`)
      expect(planned(AT_1359)).toEqual(['2026-10-21 true', '2026-10-20 true', '2026-10-19 false'])
      expect(planned(new Date('2026-10-20T12:00:00Z'))).toEqual(['2026-10-21 true', '2026-10-20 false', '2026-10-19 false'])
      expect(planned(AT_1401)).toEqual(['2026-10-21 true', '2026-10-20 false', '2026-10-19 false'])
      expect(getChild(db, staff, kidA, TODAY, AT_1359).meetings.map(meeting => meeting.planned)).toEqual([true, true, false])
    })
  })

  describe('deleting', () => {
    it('deletes only that meeting', () => {
      const keep = addMeeting(db, leitung, kidA, input(), NOW)
      const gone = addMeeting(db, leitung, kidA, input({ date: '2026-09-01' }), NOW)
      deleteMeeting(db, leitung, gone, NOW)
      expect(meetingsOf(db, leitung, kidA, NOW).map(meeting => meeting.id)).toEqual([keep])
    })

    it('removes the meetings with the deleted child (Review Focus 5)', () => {
      addMeeting(db, leitung, kidA, input(), NOW)
      addMeeting(db, leitung, kidB, input(), NOW)
      db.update(children).set({ leftOn: '2010-01-01' }).where(eq(children.id, kidA)).run()
      deleteChild(db, 1, kidA)
      expect(db.select({ childId: childParentMeetings.childId }).from(childParentMeetings).all()).toEqual([{ childId: kidB }])
    })
  })
})
