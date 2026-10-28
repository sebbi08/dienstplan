import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDevelopmentDocs, childParentMeetings, children, employees, facilities } from '../../server/db/schema'
import type { ChildViewer } from '../../server/lib/childViewer'
import { getChild } from '../../server/services/children'
import { setGroupDocSettings, setReminderSettings } from '../../server/services/reminderSettings'
import { addMeeting } from '../../server/services/parentMeetings'
import { listReminders, markDocDone, undoDocDone } from '../../server/services/reminders'
import type { DocSettings } from '../../shared/domain/reminders'
import type { MeetingKind } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode, permissionsOf,
} from '../helpers/fixtures'

const TODAY = '2026-10-20'
const NOW = new Date('2026-10-20T08:00:00Z')
const TOMORROW = new Date('2026-10-21T08:00:00Z')

const INTERVAL: DocSettings = { mode: 'interval', intervalMonths: 12, leadWeeks: 2 }
const OFF: DocSettings = { mode: 'off', intervalMonths: 12, leadWeeks: 2 }
const BIRTHDAY: DocSettings = { mode: 'birthday', intervalMonths: 12, leadWeeks: 2 }
/** The documentation settings of the tests are switched on long ago, so „gilt seit“ does not hold the due days back. */
const LONG_AGO = new Date('2020-01-01T08:00:00Z')

describe('reminders', () => {
  let db: Db
  let baeren: number
  let maeuse: number
  let fuechse: number
  let berta: number
  /** Berta at the tablet without an account: own group Bären, Mäuse readable, Füchse hidden. */
  let staff: ChildViewer
  let leitung: ChildViewer

  beforeEach(() => {
    db = createTestDb()
    baeren = addGroup(db, 1, 'Bären')
    maeuse = addGroup(db, 1, 'Mäuse')
    fuechse = addGroup(db, 1, 'Füchse')
    berta = addEmployee(db, 'Berta', { groupId: baeren })
    staff = {
      id: null, employeeId: berta, name: 'Berta', role: 'observer', canEditChildren: false, permissions: permissionsOf('observer'),
      facilityId: 1,
      visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: { own: baeren, readable: [maeuse] },
    }
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    for (const group of [baeren, maeuse, fuechse]) setGroupDocSettings(db, 1, group, INTERVAL, LONG_AGO)
  })

  /** An active child whose interval documentation (12 months after entry) is due on `due`. */
  const docChild = (firstName: string, groupId: number | null, due: string, extra: Parameters<typeof addChild>[2] = {}) =>
    addChild(db, 1, {
      firstName, lastName: 'Kind', groupId, entryDate: `${Number(due.slice(0, 4)) - 1}${due.slice(4)}`,
      birthDate: '2022-03-15', ...extra,
    })

  const kindsFor = (viewer: ChildViewer, today = TODAY) =>
    listReminders(db, viewer, today).map(reminder => `${reminder.kind}:${reminder.name}`)

  describe('documentation', () => {
    it('lists a documentation due within the lead window with the button', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      expect(listReminders(db, staff, TODAY)).toEqual([{
        kind: 'doc', date: '2026-10-25', state: 'upcoming', name: 'Lena Kind', childId: id, age: null, ownChild: false,
        canDone: true, time: null, meetingKind: null, count: null,
      }])
    })

    it('leaves out a documentation before its lead window, and marks today and overdue', () => {
      docChild('Spät', baeren, '2026-11-20')
      docChild('Heute', baeren, TODAY)
      docChild('Alt', baeren, '2026-09-01')
      expect(listReminders(db, staff, TODAY).map(reminder => [reminder.name, reminder.state, reminder.date])).toEqual([
        ['Alt Kind', 'overdue', '2026-09-01'],
        ['Heute Kind', 'today', TODAY],
      ])
    })

    it('shows staff only the own group, never a read-only or hidden one; Leitung and staff without group see all', () => {
      docChild('Bär', baeren, '2026-10-25')
      docChild('Maus', maeuse, '2026-10-25')
      docChild('Fuchs', fuechse, '2026-10-25')
      docChild('Ohne', null, '2026-10-25')
      setReminderSettings(db, 1, {
        noGroupDoc: INTERVAL, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4,
      }, LONG_AGO)
      expect(kindsFor(staff)).toEqual(['doc:Bär Kind', 'doc:Ohne Kind'])
      expect(kindsFor(leitung)).toEqual(['doc:Bär Kind', 'doc:Fuchs Kind', 'doc:Maus Kind', 'doc:Ohne Kind'])
      expect(kindsFor({ ...staff, groups: null })).toHaveLength(4)
    })

    it('uses the setting of the child\'s group today: a change applies at once, „aus“ hides it', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      setGroupDocSettings(db, 1, maeuse, OFF)
      db.update(children).set({ groupId: maeuse }).where(eq(children.id, id)).run()
      expect(listReminders(db, leitung, TODAY)).toEqual([])
      setGroupDocSettings(db, 1, fuechse, BIRTHDAY, NOW)
      db.update(children).set({ groupId: fuechse, birthDate: '2022-10-25' }).where(eq(children.id, id)).run()
      expect(listReminders(db, leitung, TODAY).map(reminder => [reminder.kind, reminder.date]))
        .toEqual([['doc', '2026-10-25'], ['birthday', '2026-10-25']])
      setGroupDocSettings(db, 1, fuechse, OFF)
      expect(listReminders(db, leitung, TODAY).map(reminder => reminder.kind)).toEqual(['birthday'])
    })

    it('ignores children who are planned or have left', () => {
      docChild('Geplant', baeren, '2026-10-25', { entryDate: null, plannedEntryDate: '2025-10-25' })
      docChild('Weg', baeren, '2026-10-25', { leftOn: '2026-10-01' })
      docChild('Warte', baeren, '2026-10-25', { admissionStatus: 'waitlist' })
      expect(listReminders(db, leitung, TODAY)).toEqual([])
    })

    it('switching a group on today does not make long-enrolled children overdue (interval and birthday)', () => {
      setGroupDocSettings(db, 1, baeren, OFF, NOW)
      setGroupDocSettings(db, 1, baeren, INTERVAL, NOW)
      const id = addChild(db, 1, { firstName: 'Alt', lastName: 'Kind', groupId: baeren, entryDate: '2021-09-01', birthDate: '2020-10-21' })
      expect(listReminders(db, leitung, TODAY).map(reminder => reminder.kind)).toEqual(['birthday'])
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2027-10-20')
      setGroupDocSettings(db, 1, baeren, BIRTHDAY, NOW)
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2026-10-21')
      expect(listReminders(db, leitung, TODAY).map(reminder => [reminder.kind, reminder.state]))
        .toEqual([['doc', 'upcoming'], ['birthday', 'upcoming']])
    })

    it('a child entering after „gilt seit“ counts from its entry', () => {
      setGroupDocSettings(db, 1, baeren, OFF, NOW)
      setGroupDocSettings(db, 1, baeren, { ...INTERVAL, intervalMonths: 6 }, NOW)
      const id = addChild(db, 1, { firstName: 'Neu', lastName: 'Kind', groupId: baeren, entryDate: '2026-11-02' })
      expect(getChild(db, leitung, id, '2026-11-02').developmentDoc.nextDue).toBe('2027-05-02')
    })

    it('a start („Beginn“) in the past counts from the start, overdue once passed; „Erledigt“ still wins', () => {
      const id = addChild(db, 1, { firstName: 'Alt', lastName: 'Kind', groupId: baeren, entryDate: '2021-09-01' })
      setGroupDocSettings(db, 1, baeren, { ...INTERVAL, intervalMonths: 1, docSince: '2026-09-01' }, NOW)
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2026-10-01')
      expect(listReminders(db, leitung, TODAY).filter(reminder => reminder.kind === 'doc').map(reminder => [reminder.state, reminder.date]))
        .toEqual([['overdue', '2026-10-01']])
      setGroupDocSettings(db, 1, baeren, { ...INTERVAL, docSince: '2026-09-01' }, NOW)
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2027-09-01')
      markDocDone(db, leitung, id, NOW)
      setGroupDocSettings(db, 1, baeren, { ...INTERVAL, docSince: '2020-01-01' }, NOW)
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2027-10-20')
    })

    it('a start in the future shows nothing before it; a child entering after the start counts from its entry', () => {
      const old = addChild(db, 1, { firstName: 'Alt', lastName: 'Kind', groupId: baeren, entryDate: '2021-09-01' })
      setGroupDocSettings(db, 1, baeren, { ...INTERVAL, intervalMonths: 1, docSince: '2027-09-01' }, NOW)
      expect(getChild(db, leitung, old, TODAY).developmentDoc.nextDue).toBe('2027-10-01')
      expect(listReminders(db, leitung, TODAY).filter(reminder => reminder.kind === 'doc')).toEqual([])
      expect(listReminders(db, leitung, '2027-09-01').filter(reminder => reminder.kind === 'doc')).toEqual([])
      const neu = addChild(db, 1, { firstName: 'Neu', lastName: 'Kind', groupId: baeren, entryDate: '2027-11-02' })
      expect(getChild(db, leitung, neu, '2027-11-02').developmentDoc.nextDue).toBe('2027-12-02')
    })

    it('a mode change resets „gilt seit“, a changed interval keeps it', () => {
      const id = docChild('Lena', baeren, '2026-09-01')
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2026-09-01')
      setGroupDocSettings(db, 1, baeren, { ...INTERVAL, intervalMonths: 6, leadWeeks: 4 }, NOW)
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2026-03-01')
      setGroupDocSettings(db, 1, baeren, BIRTHDAY, NOW)
      setGroupDocSettings(db, 1, baeren, INTERVAL, NOW)
      expect(getChild(db, leitung, id, TODAY).developmentDoc.nextDue).toBe('2027-10-20')
    })

    it('a birthday passed without done stays overdue the next day and a month later', () => {
      setGroupDocSettings(db, 1, baeren, BIRTHDAY, new Date('2026-10-01T08:00:00Z'))
      addChild(db, 1, { firstName: 'Lena', lastName: 'Kind', groupId: baeren, entryDate: '2024-09-01', birthDate: '2022-10-19' })
      const docOf = (today: string) => listReminders(db, leitung, today)
        .filter(reminder => reminder.kind === 'doc').map(reminder => [reminder.state, reminder.date])
      expect(docOf('2026-10-19')).toEqual([['today', '2026-10-19']])
      expect(docOf(TODAY)).toEqual([['overdue', '2026-10-19']])
      expect(docOf('2026-11-20')).toEqual([['overdue', '2026-10-19']])
    })

    it('marks the key educator\'s own child', () => {
      docChild('Lena', baeren, '2026-10-25', { keyEducatorId: berta })
      expect(listReminders(db, staff, TODAY)[0]!.ownChild).toBe(true)
      expect(listReminders(db, leitung, TODAY)[0]!.ownChild).toBe(false)
    })
  })

  describe('done and undo', () => {
    it('stores the tablet person without account by name and hides the reminder until the next due date', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      const docId = markDocDone(db, staff, id, NOW)
      expect(db.select().from(childDevelopmentDocs).all()).toEqual([{
        id: docId, childId: id, doneOn: TODAY, doneByUserId: null, doneByEmployeeId: berta, doneByName: 'Berta',
        createdAt: NOW.toISOString(),
      }])
      expect(listReminders(db, staff, TODAY)).toEqual([])
      expect(getChild(db, staff, id, TODAY).developmentDoc).toEqual({
        lastDone: { id: docId, date: TODAY, name: 'Berta' }, nextDue: '2027-10-20', canUndo: true, canDone: true,
      })
    })

    it('is idempotent per day: a second „Erledigt“ the same day returns the same entry', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      const first = markDocDone(db, staff, id, NOW)
      expect(markDocDone(db, leitung, id, new Date('2026-10-20T15:00:00Z'))).toBe(first)
      expect(db.select().from(childDevelopmentDocs).all()).toHaveLength(1)
      const next = markDocDone(db, staff, id, TOMORROW)
      expect(next).not.toBe(first)
      expect(db.select().from(childDevelopmentDocs).all()).toHaveLength(2)
    })

    it('lets staff with a group mark and undo only in the own group, staff without group everywhere', () => {
      const fuchs = docChild('Fuchs', fuechse, '2026-10-25')
      expect(errorCode(() => markDocDone(db, staff, fuchs, NOW))).toBe('child_not_found')
      const helper: ChildViewer = { ...staff, groups: null }
      const docId = markDocDone(db, helper, fuchs, NOW)
      expect(errorCode(() => undoDocDone(db, staff, docId, NOW))).toBe('child_not_found')
      expect(getChild(db, helper, fuchs, TODAY).developmentDoc.canUndo).toBe(true)
      undoDocDone(db, helper, docId, NOW)
      expect(db.select().from(childDevelopmentDocs).all()).toEqual([])
    })

    it('stores the account of a logged-in viewer', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      markDocDone(db, leitung, id, NOW)
      expect(db.select().from(childDevelopmentDocs).get()).toMatchObject({
        doneByUserId: leitung.id, doneByEmployeeId: null, doneByName: 'leitung',
      })
    })

    it('refuses a child of a read-only group (403) and one the viewer does not see (404)', () => {
      const maus = docChild('Maus', maeuse, '2026-10-25')
      const fuchs = docChild('Fuchs', fuechse, '2026-10-25')
      expect(errorCode(() => markDocDone(db, staff, maus, NOW))).toBe('group_read_only')
      expect(errorCode(() => markDocDone(db, staff, fuchs, NOW))).toBe('child_not_found')
      expect(errorCode(() => markDocDone(db, staff, 9999, NOW))).toBe('child_not_found')
      const other = addFacility(db, 'Krippe')
      const foreign = addChild(db, other, {})
      expect(errorCode(() => markDocDone(db, leitung, foreign, NOW))).toBe('child_not_found')
      expect(db.select().from(childDevelopmentDocs).all()).toEqual([])
    })

    it('refuses undo of a read-only group\'s done (403)', () => {
      const maus = docChild('Maus', maeuse, '2026-10-25')
      const docId = markDocDone(db, leitung, maus, NOW)
      expect(errorCode(() => undoDocDone(db, staff, docId, NOW))).toBe('group_read_only')
      expect(getChild(db, staff, maus, TODAY).developmentDoc.canUndo).toBe(false)
      expect(getChild(db, staff, maus, TODAY).developmentDoc.canDone).toBe(false)
    })

    it('lets staff undo only on the same day, Leitung later as well; then the previous done counts', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      db.insert(childDevelopmentDocs)
        .values({ childId: id, doneOn: '2025-10-15', doneByName: 'Anna', createdAt: '2025-10-15T08:00:00.000Z' }).run()
      expect(listReminders(db, staff, TODAY).map(reminder => [reminder.state, reminder.date])).toEqual([['overdue', '2026-10-15']])

      const sameDay = markDocDone(db, staff, id, NOW)
      undoDocDone(db, staff, sameDay, NOW)
      expect(listReminders(db, staff, TODAY).map(reminder => reminder.date)).toEqual(['2026-10-15'])

      const docId = markDocDone(db, staff, id, NOW)
      expect(getChild(db, staff, id, '2026-10-21').developmentDoc.canUndo).toBe(false)
      expect(errorCode(() => undoDocDone(db, staff, docId, TOMORROW))).toBe('undo_too_late')
      expect(getChild(db, leitung, id, '2026-10-21').developmentDoc.canUndo).toBe(true)
      undoDocDone(db, leitung, docId, TOMORROW)
      expect(listReminders(db, staff, '2026-10-21').map(reminder => [reminder.state, reminder.date]))
        .toEqual([['overdue', '2026-10-15']])
      expect(getChild(db, leitung, id, '2026-10-21').developmentDoc.lastDone)
        .toEqual({ id: expect.any(Number), date: '2025-10-15', name: 'Anna' })
    })

    it('undoes only the child\'s latest „Erledigt“ (409 undo_not_latest), also for Leitung', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      const older = db.insert(childDevelopmentDocs)
        .values({ childId: id, doneOn: '2025-10-15', doneByName: 'Anna', createdAt: '2025-10-15T08:00:00.000Z' }).returning().get().id
      const latest = markDocDone(db, leitung, id, NOW)
      expect(errorCode(() => undoDocDone(db, leitung, older, NOW))).toBe('undo_not_latest')
      expect(db.select().from(childDevelopmentDocs).all()).toHaveLength(2)
      undoDocDone(db, leitung, latest, NOW)
      undoDocDone(db, leitung, older, NOW)
      expect(db.select().from(childDevelopmentDocs).all()).toEqual([])
    })

    it('refuses undo for a child who has left: 409 child_archived for Leitung, 404 for staff', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      const docId = markDocDone(db, leitung, id, NOW)
      db.update(children).set({ leftOn: TODAY }).where(eq(children.id, id)).run()
      const nextDay = new Date('2026-10-21T08:00:00Z')
      expect(errorCode(() => undoDocDone(db, leitung, docId, nextDay))).toBe('child_archived')
      expect(errorCode(() => undoDocDone(db, staff, docId, nextDay))).toBe('child_not_found')
      expect(db.select().from(childDevelopmentDocs).all()).toHaveLength(1)
    })

    it('answers 404 for an unknown done or one of another facility', () => {
      const other = addFacility(db, 'Krippe')
      const foreign = addChild(db, other, {})
      const docId = db.insert(childDevelopmentDocs)
        .values({ childId: foreign, doneOn: TODAY, doneByName: 'X', createdAt: NOW.toISOString() }).returning().get().id
      expect(errorCode(() => undoDocDone(db, leitung, docId, NOW))).toBe('development_doc_not_found')
      expect(errorCode(() => undoDocDone(db, leitung, 9999, NOW))).toBe('development_doc_not_found')
    })

    it('shows the record\'s documentation without done and with the setting off', () => {
      const id = docChild('Lena', baeren, '2026-10-25')
      expect(getChild(db, staff, id, TODAY).developmentDoc)
        .toEqual({ lastDone: null, nextDue: '2026-10-25', canUndo: false, canDone: true })
      setGroupDocSettings(db, 1, baeren, OFF)
      expect(getChild(db, staff, id, TODAY).developmentDoc)
        .toEqual({ lastDone: null, nextDue: null, canUndo: false, canDone: true })
    })
  })

  describe('birthdays', () => {
    beforeEach(() => {
      for (const group of [baeren, maeuse, fuechse]) setGroupDocSettings(db, 1, group, OFF)
    })

    it('lists children\'s birthdays within the lead days with the age they turn, own group only', () => {
      const lena = addChild(db, 1, { firstName: 'Lena', lastName: 'Sommer', groupId: baeren, birthDate: '2021-10-23' })
      addChild(db, 1, { firstName: 'Tom', lastName: 'Heute', groupId: baeren, birthDate: '2022-10-20' })
      addChild(db, 1, { firstName: 'Spät', lastName: 'Kind', groupId: baeren, birthDate: '2021-10-28' })
      addChild(db, 1, { firstName: 'Maus', lastName: 'Kind', groupId: maeuse, birthDate: '2021-10-22' })
      expect(listReminders(db, staff, TODAY)).toEqual([
        { kind: 'birthday', date: TODAY, state: 'today', name: 'Tom Heute', childId: expect.any(Number), age: 4, ownChild: false, canDone: false, time: null, meetingKind: null, count: null },
        { kind: 'birthday', date: '2026-10-23', state: 'upcoming', name: 'Lena Sommer', childId: lena, age: 5, ownChild: false, canDone: false, time: null, meetingKind: null, count: null },
      ])
      expect(kindsFor(leitung)).toEqual(['birthday:Tom Heute', 'birthday:Maus Kind', 'birthday:Lena Sommer'])
    })

    it('lists staff birthdays of the facility for everyone, never of employees who left', () => {
      db.update(employees).set({ birthday: '10-22' }).where(eq(employees.id, berta)).run()
      const anna = addEmployee(db, 'Anna', { leftOn: '2026-12-31' })
      db.update(employees).set({ birthday: '10-20' }).where(eq(employees.id, anna)).run()
      const gone = addEmployee(db, 'Gerd', { leftOn: '2026-09-30' })
      db.update(employees).set({ birthday: '10-21' }).where(eq(employees.id, gone)).run()
      const krippe = addFacility(db, 'Krippe')
      const away = addEmployee(db, 'Fremd', { facilityId: krippe })
      db.update(employees).set({ birthday: '10-21' }).where(eq(employees.id, away)).run()
      const late = addEmployee(db, 'Spät')
      db.update(employees).set({ birthday: '11-20' }).where(eq(employees.id, late)).run()
      addEmployee(db, 'Ohne')
      const expected = [
        { kind: 'staffBirthday', date: TODAY, state: 'today', name: 'Anna', childId: null, age: null, ownChild: false, canDone: false, time: null, meetingKind: null, count: null },
        { kind: 'staffBirthday', date: '2026-10-22', state: 'upcoming', name: 'Berta', childId: null, age: null, ownChild: false, canDone: false, time: null, meetingKind: null, count: null },
      ]
      expect(listReminders(db, staff, TODAY)).toEqual(expected)
      expect(listReminders(db, leitung, TODAY)).toEqual(expected)
    })

    it('uses the facility\'s lead days for children and staff separately', () => {
      setReminderSettings(db, 1, { noGroupDoc: OFF, birthdayLeadDays: 2, staffBirthdayLeadDays: 0, leavingLeadWeeks: 4 })
      addChild(db, 1, { firstName: 'Lena', lastName: 'Sommer', groupId: baeren, birthDate: '2021-10-23' })
      addChild(db, 1, { firstName: 'Tom', lastName: 'Bald', groupId: baeren, birthDate: '2021-10-22' })
      db.update(employees).set({ birthday: '10-21' }).where(eq(employees.id, berta)).run()
      expect(kindsFor(staff)).toEqual(['birthday:Tom Bald'])
      expect(kindsFor(staff, '2026-10-21')).toEqual(['staffBirthday:Berta', 'birthday:Tom Bald', 'birthday:Lena Sommer'])
    })
  })

  describe('leaving', () => {
    beforeEach(() => {
      for (const group of [baeren, maeuse, fuechse]) setGroupDocSettings(db, 1, group, OFF)
    })

    it('lists a registered leaving day within the lead weeks until the day', () => {
      const id = addChild(db, 1, { firstName: 'Lena', lastName: 'Sommer', groupId: baeren, leftOn: '2026-11-10' })
      addChild(db, 1, { firstName: 'Spät', lastName: 'Kind', groupId: baeren, leftOn: '2026-12-31' })
      addChild(db, 1, { firstName: 'Maus', lastName: 'Kind', groupId: maeuse, leftOn: '2026-11-10' })
      expect(listReminders(db, staff, TODAY)).toEqual([{
        kind: 'leaving', date: '2026-11-10', state: 'upcoming', name: 'Lena Sommer', childId: id, age: null, ownChild: false,
        canDone: false, time: null, meetingKind: null, count: null,
      }])
      expect(listReminders(db, staff, '2026-11-10').map(reminder => reminder.state)).toEqual(['today'])
      expect(listReminders(db, staff, '2026-10-12')).toEqual([])
      expect(kindsFor(leitung)).toEqual(['leaving:Lena Sommer', 'leaving:Maus Kind'])
    })

    it('lists the automatic deregistration of a school child while the switch is on', () => {
      const id = addChild(db, 1, {
        firstName: 'Paul', lastName: 'Schule', groupId: baeren, birthDate: '2020-05-01', entryDate: '2023-09-01',
        schoolStartDate: '2026-11-01',
      })
      expect(listReminders(db, staff, TODAY)).toEqual([])
      db.update(facilities).set({ autoLeaveSchoolChildren: true }).where(eq(facilities.id, 1)).run()
      expect(listReminders(db, staff, TODAY)).toEqual([{
        kind: 'leaving', date: '2026-10-31', state: 'upcoming', name: 'Paul Schule', childId: id, age: null, ownChild: false,
        canDone: false, time: null, meetingKind: null, count: null,
      }])
      setReminderSettings(db, 1, { noGroupDoc: OFF, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 1 })
      expect(listReminders(db, staff, TODAY)).toEqual([])
    })
  })

  describe('parent meetings', () => {
    beforeEach(() => {
      for (const group of [baeren, maeuse, fuechse]) setGroupDocSettings(db, 1, group, OFF)
    })

    const meetingOf = (childId: number, date: string, start: number, kind: MeetingKind = 'development') =>
      addMeeting(db, leitung, childId, { date, start, end: null, kind, participants: 'Eltern', note: 'Vertraulich' }, NOW)

    it('lists a meeting only on its day, all day long, with time and kind and without „Erledigt“', () => {
      const id = addChild(db, 1, { firstName: 'Lena', lastName: 'Sommer', groupId: baeren, keyEducatorId: berta })
      meetingOf(id, TODAY, 840)
      meetingOf(id, '2026-10-21', 600, 'final')
      meetingOf(id, '2026-10-19', 600, 'other')
      const expected = [{
        kind: 'meeting', date: TODAY, state: 'today', name: 'Lena Sommer', childId: id, age: null, ownChild: true,
        canDone: false, time: 840, meetingKind: 'development', count: null,
      }]
      expect(listReminders(db, staff, TODAY)).toEqual(expected)
      // Before the start and after it the same: the reminder holds for the whole day; the note never comes along.
      expect(JSON.stringify(listReminders(db, leitung, TODAY))).not.toContain('Vertraulich')
      expect(listReminders(db, staff, '2026-10-21').map(reminder => [reminder.kind, reminder.meetingKind, reminder.time]))
        .toEqual([['meeting', 'final', 600]])
      expect(listReminders(db, staff, '2026-10-22')).toEqual([])
      expect(listReminders(db, staff, '2026-10-18')).toEqual([])
    })

    it('shows staff the own group\'s and group-less children\'s meetings, never a read-only or hidden group; Leitung all', () => {
      meetingOf(addChild(db, 1, { firstName: 'Bär', lastName: 'Kind', groupId: baeren }), TODAY, 600)
      meetingOf(addChild(db, 1, { firstName: 'Maus', lastName: 'Kind', groupId: maeuse }), TODAY, 600)
      meetingOf(addChild(db, 1, { firstName: 'Fuchs', lastName: 'Kind', groupId: fuechse }), TODAY, 600)
      meetingOf(addChild(db, 1, { firstName: 'Ohne', lastName: 'Kind', groupId: null }), TODAY, 600)
      expect(kindsFor(staff)).toEqual(['meeting:Bär Kind', 'meeting:Ohne Kind'])
      expect(kindsFor(leitung)).toEqual(['meeting:Bär Kind', 'meeting:Fuchs Kind', 'meeting:Maus Kind', 'meeting:Ohne Kind'])
    })

    it('leaves out the meetings of a child who has left, and of another facility', () => {
      const id = addChild(db, 1, { firstName: 'Lena', lastName: 'Sommer', groupId: baeren })
      meetingOf(id, TODAY, 600)
      db.update(children).set({ leftOn: '2026-10-19' }).where(eq(children.id, id)).run()
      const krippe = addFacility(db, 'Krippe')
      const foreign = addChild(db, krippe, { groupId: null })
      db.insert(childParentMeetings).values({
        childId: foreign, date: TODAY, start: 600, kind: 'other', createdByName: 'X', createdAt: NOW.toISOString(),
      }).run()
      expect(listReminders(db, leitung, TODAY)).toEqual([])
    })

    describe('children who have not started yet', () => {
      /** Staff at the tablet with the switches for Vormerkungen and future contracts on. */
      let staffSeeing: ChildViewer
      beforeEach(() => {
        staffSeeing = { ...staff, visibility: { waitlist: true, futureContracts: true } }
      })
      const future = (extra: Parameters<typeof addChild>[2] = {}) =>
        addChild(db, 1, { firstName: 'Neu', lastName: 'Kind', groupId: baeren, entryDate: '2027-01-01', ...extra })
      const waiting = (extra: Parameters<typeof addChild>[2] = {}) =>
        addChild(db, 1, { firstName: 'Warte', lastName: 'Kind', groupId: baeren, admissionStatus: 'waitlist', entryDate: null, ...extra })

      it('lists a future-entry contract child\'s meeting on its day for Leitung and the promised group\'s staff', () => {
        const id = future({ keyEducatorId: berta })
        meetingOf(id, TODAY, 840)
        const expected = [{
          kind: 'meeting', date: TODAY, state: 'today', name: 'Neu Kind', childId: id, age: null, ownChild: true,
          canDone: false, time: 840, meetingKind: 'development', count: null,
        }]
        expect(listReminders(db, leitung, TODAY)).toEqual([{ ...expected[0], ownChild: false }])
        expect(listReminders(db, staffSeeing, TODAY)).toEqual(expected)
        expect(listReminders(db, staffSeeing, '2026-10-21')).toEqual([])
      })

      it('also lists a contract child without entry date but a planned one', () => {
        meetingOf(future({ entryDate: null, plannedEntryDate: '2027-03-01' }), TODAY, 600)
        expect(kindsFor(leitung)).toEqual(['meeting:Neu Kind'])
      })

      it('shows staff only the promised group\'s children (own group, none), never another or a read-only group', () => {
        meetingOf(future({ firstName: 'Bär' }), TODAY, 600)
        meetingOf(future({ firstName: 'Maus', groupId: maeuse }), TODAY, 600)
        meetingOf(future({ firstName: 'Fuchs', groupId: fuechse }), TODAY, 600)
        meetingOf(future({ firstName: 'Ohne', groupId: null }), TODAY, 600)
        expect(kindsFor(staffSeeing)).toEqual(['meeting:Bär Kind', 'meeting:Ohne Kind'])
        expect(kindsFor(leitung)).toHaveLength(4)
      })

      it('leaves out a child the tablet switches hide from the viewer, for staff only', () => {
        meetingOf(future(), TODAY, 600)
        meetingOf(waiting(), TODAY, 660)
        expect(kindsFor(staff)).toEqual([])
        expect(kindsFor({ ...staff, visibility: { waitlist: true, futureContracts: false } })).toEqual(['meeting:Warte Kind'])
        expect(kindsFor({ ...staff, visibility: { waitlist: false, futureContracts: true } })).toEqual(['meeting:Neu Kind'])
        expect(kindsFor(leitung)).toEqual(['meeting:Neu Kind', 'meeting:Warte Kind'])
      })

      it('lists a waitlist child\'s meeting with the wished-for group\'s rule', () => {
        meetingOf(waiting(), TODAY, 600)
        meetingOf(waiting({ firstName: 'Fuchs', groupId: fuechse }), TODAY, 660)
        expect(kindsFor(staffSeeing)).toEqual(['meeting:Warte Kind'])
        expect(kindsFor(leitung)).toEqual(['meeting:Warte Kind', 'meeting:Fuchs Kind'])
      })

      it('lists no meeting of a child who has left', () => {
        const contract = future()
        const waitlist = waiting()
        meetingOf(contract, TODAY, 600)
        meetingOf(waitlist, TODAY, 660)
        db.update(children).set({ leftOn: '2026-10-19' }).where(eq(children.id, contract)).run()
        db.update(children).set({ leftOn: '2026-10-19' }).where(eq(children.id, waitlist)).run()
        expect(listReminders(db, leitung, TODAY)).toEqual([])
      })

      it('gives planned children no documentation, birthday or leaving reminder', () => {
        setGroupDocSettings(db, 1, baeren, INTERVAL, LONG_AGO)
        future({ birthDate: '2022-10-22' })
        waiting({ birthDate: '2022-10-22' })
        expect(listReminders(db, leitung, TODAY)).toEqual([])
        expect(listReminders(db, staffSeeing, TODAY)).toEqual([])
      })
    })

    it('sorts a meeting after the documentation and before the birthdays of the day, meetings by time', () => {
      setGroupDocSettings(db, 1, baeren, INTERVAL, LONG_AGO)
      const lena = docChild('Lena', baeren, TODAY, { birthDate: '2022-10-20' })
      // Entered lately: their documentation is not due yet.
      const zoe = addChild(db, 1, { firstName: 'Zoe', lastName: 'Kind', groupId: baeren, entryDate: '2026-09-01' })
      const ali = addChild(db, 1, { firstName: 'Ali', lastName: 'Kind', groupId: baeren, entryDate: '2026-09-01' })
      meetingOf(lena, TODAY, 900)
      meetingOf(zoe, TODAY, 480)
      meetingOf(ali, TODAY, 840)
      db.update(employees).set({ birthday: '10-20' }).where(eq(employees.id, berta)).run()
      expect(kindsFor(staff)).toEqual([
        'doc:Lena Kind', 'meeting:Zoe Kind', 'meeting:Ali Kind', 'meeting:Lena Kind', 'birthday:Lena Kind', 'staffBirthday:Berta',
      ])
    })
  })

  it('sorts overdue, today, then by date and kind', () => {
    for (const group of [maeuse, fuechse]) setGroupDocSettings(db, 1, group, OFF)
    docChild('Alt', baeren, '2026-09-01')
    docChild('Bald', baeren, '2026-10-23', { birthDate: '2021-10-23' })
    db.update(employees).set({ birthday: '10-20' }).where(eq(employees.id, berta)).run()
    addChild(db, 1, { firstName: 'Weg', lastName: 'Kind', groupId: baeren, entryDate: '2026-01-01', leftOn: '2026-10-22' })
    expect(kindsFor(staff)).toEqual([
      'doc:Alt Kind', 'staffBirthday:Berta', 'leaving:Weg Kind', 'doc:Bald Kind', 'birthday:Bald Kind',
    ])
  })
})

// Review Focus 5: the reminder about the page „Löschfristen“ is for the Träger only, and only while something is due.
describe('retention reminder', () => {
  let db: Db
  let traeger: ChildViewer
  let leitung: ChildViewer
  const retentionOf = (viewer: ChildViewer, today = TODAY) =>
    listReminders(db, viewer, today).filter(reminder => reminder.kind === 'retention')

  beforeEach(() => {
    db = createTestDb()
    traeger = asChildViewer(addUser(db, 'traeger', 'provider'))
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
  })

  it('shows the Träger the number of due entries of all facilities', () => {
    const hort = addFacility(db, 'Hort')
    addChild(db, 1, { firstName: 'Alt', lastName: 'Kind', entryDate: '2005-08-01', leftOn: '2010-07-31' })
    addChild(db, hort, { firstName: 'Hort', lastName: 'Kind', entryDate: '2005-08-01', leftOn: '2011-07-31' })
    expect(retentionOf(traeger)).toEqual([{
      kind: 'retention', date: TODAY, state: 'today', name: '', childId: null, age: null, ownChild: false, canDone: false,
      time: null, meetingKind: null, count: 2,
    }])
  })

  it('never shows it to the Leitung, a Mitarbeiter or at the tablet, also with due entries', () => {
    addChild(db, 1, { firstName: 'Alt', lastName: 'Kind', entryDate: '2005-08-01', leftOn: '2010-07-31' })
    expect(retentionOf(leitung)).toEqual([])
    expect(retentionOf(asChildViewer(addUser(db, 'mitarbeiter', 'observer')))).toEqual([])
    expect(retentionOf({ ...traeger, onTablet: true })).toEqual([])
  })

  it('leaves it out for the Träger while nothing is due yet', () => {
    // Left recently: the record may only be deleted after the retention period.
    addChild(db, 1, { firstName: 'Neu', lastName: 'Kind', entryDate: '2020-08-01', leftOn: '2026-07-31' })
    expect(retentionOf(traeger)).toEqual([])
    expect(retentionOf(traeger, '2045-01-01')).toHaveLength(1)
  })
})
