import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  childAttendanceChanges, childAttendanceDays, childAttendanceMonths, childAttendanceStays, childContacts, childPickupAnnouncements,
  closures,
} from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import {
  announcePickup, arrive, attendanceHistory, deleteStay, getAttendanceDay, leave, removeAnnouncement, setAbsence, updateDay,
  updateStay,
} from '../../server/services/childAttendance'
import { addContact } from '../../server/services/childContacts'
import { planGroupChange } from '../../server/services/childGroupChanges'
import { deleteChild } from '../../server/services/children'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { AttendancePickupChoice, ChildContactInput } from '../../shared/types/api'
import {
  addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode,
} from '../helpers/fixtures'

/** A moment in Berlin: summer time until the end of October, winter time in November to February. */
const berlin = (date: string, time: string) =>
  new Date(`${date}T${time}:00${['11', '12', '01', '02'].includes(date.slice(5, 7)) ? '+01:00' : '+02:00'}`)
const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

const TODAY = '2026-10-14' // a Wednesday
const YESTERDAY = '2026-10-13'
const NOW = berlin(TODAY, '10:00')

const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})

describe('child attendance', () => {
  let db: Db
  let leitung: ChildActor
  let lena: number
  let mama: number
  let opa: number
  let papa: number

  beforeEach(() => {
    db = createTestDb()
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    lena = addChild(db, 1, { lastName: 'Meier', firstName: 'Lena', allergies: 'Nüsse' })
    mama = addContact(db, leitung, 1, lena, contact(), TODAY, NOW)
    opa = addContact(db, leitung, 1, lena, contact({ name: 'Opa Karl', relation: 'Opa', isGuardian: false, mayPickUp: false }), TODAY, NOW)
    papa = addContact(db, leitung, 1, lena, contact({
      name: 'Max Meier', relation: 'Vater', mayPickUp: false, contactBan: true, contactBanNote: 'Kein Umgang laut Gericht',
    }), TODAY, NOW)
  })

  const dayOf = (date = TODAY, now = NOW, viewer = leitung) => getAttendanceDay(db, viewer, date, now)
  const rowOf = (childId = lena, date = TODAY, now = NOW) => dayOf(date, now).children.find(child => child.childId === childId)!
  const arriveAt = (time: string, options: { childId?: number; date?: string; plannedPickup?: number | null; now?: Date } = {}) =>
    arrive(db, leitung, {
      childId: options.childId ?? lena, date: options.date ?? TODAY, time: hm(time),
      plannedPickup: options.plannedPickup === undefined ? hm('15:00') : options.plannedPickup,
    }, options.now ?? NOW)
  const leaveAt = (time: string, pickup: AttendancePickupChoice | null, options: { childId?: number; date?: string } = {}) =>
    leave(db, leitung, { childId: options.childId ?? lena, date: options.date ?? TODAY, time: hm(time), pickup }, NOW)
  const mamaPickup = (): AttendancePickupChoice => ({ kind: 'contact', id: mama })

  describe('arriving', () => {
    it('needs a planned pickup, refuses a second arrival while present, allows a second stay after leaving', () => {
      expect(errorCode(() => arriveAt('07:45', { plannedPickup: null }))).toBe('planned_pickup_required')
      expect(db.select().from(childAttendanceStays).all()).toEqual([])

      arriveAt('07:45')
      expect(rowOf()).toMatchObject({
        status: 'present', plannedPickup: hm('15:00'), stays: [{ arrived: hm('07:45'), left: null, pickedUpBy: null }],
      })
      expect(errorCode(() => arriveAt('08:00'))).toBe('already_present')

      leaveAt('10:00', mamaPickup())
      arriveAt('11:00', { plannedPickup: hm('16:00') })
      const row = rowOf()
      expect(row.status).toBe('present')
      expect(row.plannedPickup).toBe(hm('16:00'))
      expect(row.stays.map(stay => [stay.arrived, stay.left, stay.pickedUpBy]))
        .toEqual([[hm('07:45'), hm('10:00'), 'Anna Meier'], [hm('11:00'), null, null]])
      leaveAt('12:00', mamaPickup())
      expect(rowOf().status).toBe('gone')
    })
  })

  describe('leaving', () => {
    it('only with a person who may pick the child up', () => {
      expect(errorCode(() => leaveAt('09:00', mamaPickup()))).toBe('not_present')
      arriveAt('08:00')

      // Without "darf abholen", with a contact ban (even if the flag were set), or a contact of another child.
      expect(errorCode(() => leaveAt('15:00', { kind: 'contact', id: opa }))).toBe('pickup_person_invalid')
      db.update(childContacts).set({ mayPickUp: true }).where(eq(childContacts.id, papa)).run()
      expect(errorCode(() => leaveAt('15:00', { kind: 'contact', id: papa }))).toBe('pickup_person_invalid')
      const ben = addChild(db, 1, { lastName: 'Bauer', firstName: 'Ben' })
      const benMama = addContact(db, leitung, 1, ben, contact({ name: 'Bea Bauer' }), TODAY, NOW)
      expect(errorCode(() => leaveAt('15:00', { kind: 'contact', id: benMama }))).toBe('pickup_person_invalid')
      expect(errorCode(() => leaveAt('15:00', { kind: 'contact', id: 9999 }))).toBe('pickup_person_invalid')

      // An announcement counts only on its day and for its child.
      const yesterdays = announcePickup(db, leitung, { childId: lena, date: YESTERDAY, name: 'Tante Uta', announcedBy: '' }, NOW)
      expect(errorCode(() => leaveAt('15:00', { kind: 'announcement', id: yesterdays }))).toBe('pickup_person_invalid')
      const bensToday = announcePickup(db, leitung, { childId: ben, date: TODAY, name: 'Onkel Udo', announcedBy: '' }, NOW)
      expect(errorCode(() => leaveAt('15:00', { kind: 'announcement', id: bensToday }))).toBe('pickup_person_invalid')

      expect(errorCode(() => leaveAt('15:00', null))).toBe('pickup_person_required')
      expect(errorCode(() => leaveAt('07:59', mamaPickup()))).toBe('leave_before_arrival')
      // Nothing of that was stored.
      expect(rowOf().stays).toEqual([expect.objectContaining({ left: null, pickedUpBy: null })])

      leaveAt('15:10', mamaPickup())
      expect(rowOf().stays).toEqual([expect.objectContaining({ arrived: hm('08:00'), left: hm('15:10'), pickedUpBy: 'Anna Meier' })])
      expect(db.select().from(childAttendanceStays).get()!.pickedUpContactId).toBe(mama)
    })

    it('with a person announced for today', () => {
      const oma = announcePickup(db, leitung, { childId: lena, date: TODAY, name: '  Oma Erika ', announcedBy: 'Mama, telefonisch' }, NOW)
      expect(rowOf().announcements).toEqual([{ id: oma, name: 'Oma Erika', announcedBy: 'Mama, telefonisch' }])
      arriveAt('08:00')
      leaveAt('14:00', { kind: 'announcement', id: oma })
      expect(rowOf().stays[0]).toMatchObject({ left: hm('14:00'), pickedUpBy: 'Oma Erika' })
      expect(db.select().from(childAttendanceStays).get()!.pickedUpContactId).toBeNull()
      expect(errorCode(() => announcePickup(db, leitung, { childId: lena, date: TODAY, name: '  ', announcedBy: '' }, NOW)))
        .toBe('name_required')
    })

    it('offers exactly the allowed contacts and today\'s announcements, never a person with a contact ban', () => {
      announcePickup(db, leitung, { childId: lena, date: YESTERDAY, name: 'Tante Uta', announcedBy: '' }, NOW)
      const oma = announcePickup(db, leitung, { childId: lena, date: TODAY, name: 'Oma Erika', announcedBy: '' }, NOW)
      // Even with the flag set behind the service's back, the banned person is not offered.
      db.update(childContacts).set({ mayPickUp: true }).where(eq(childContacts.id, papa)).run()
      const row = rowOf()
      expect(row.pickupOptions).toEqual([
        { kind: 'contact', id: mama, name: 'Anna Meier' },
        { kind: 'announcement', id: oma, name: 'Oma Erika' },
      ])
      expect(row.hasContactBan).toBe(true)
      expect(row.contactBanNotes).toEqual(['Kein Umgang laut Gericht'])
      // The ban stays out of the info column.
      expect(row.allergies).toBe('Nüsse')
      expect(row.note).toBe('')

      // The banned person cannot come in as an announced person under their name either.
      expect(errorCode(() => announcePickup(db, leitung, { childId: lena, date: TODAY, name: ' max  MEIER', announcedBy: '' }, NOW)))
        .toBe('pickup_person_invalid')
      const dayId = db.select().from(childAttendanceDays).where(eq(childAttendanceDays.date, TODAY)).get()!.id
      const sneaked = db.insert(childPickupAnnouncements).values({ dayId, name: 'Max Meier' }).returning().get().id
      expect(rowOf().pickupOptions.map(option => option.id)).not.toContain(sneaked)
      arriveAt('08:00')
      expect(errorCode(() => leaveAt('12:00', { kind: 'announcement', id: sneaked }))).toBe('pickup_person_invalid')

      removeAnnouncement(db, leitung, oma, NOW)
      expect(rowOf().pickupOptions).toEqual([{ kind: 'contact', id: mama, name: 'Anna Meier' }])
      expect(errorCode(() => removeAnnouncement(db, leitung, oma, NOW))).toBe('announcement_not_found')
    })
  })

  describe('absences', () => {
    it('go only to care days without a stay; a later arrival replaces the absence of that day', () => {
      // Monday 21 to Sunday 27 December 2026: 24th a closure day, 25th and 26th public holidays, the weekend.
      db.insert(closures).values({ facilityId: 1, startDate: '2026-12-24', endDate: '2026-12-24', label: 'Heiligabend', mode: 'closure_day' }).run()
      const tuesday = berlin('2026-12-22', '09:00')
      arriveAt('08:00', { date: '2026-12-22', now: tuesday })

      expect(setAbsence(db, leitung, { childId: lena, from: '2026-12-21', to: '2026-12-27', kind: 'vacation' }, tuesday)).toBe(2)
      const status = (date: string, now = tuesday) => rowOf(lena, date, now).status
      expect(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-27'].map(date => status(date)))
        .toEqual(['vacation', 'present', 'vacation', 'not_yet', 'not_yet', 'not_yet'])
      expect(['2026-12-21', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27'].map(date => dayOf(date, tuesday).isCareDay))
        .toEqual([true, false, false, false, false])
      // The same again changes nothing.
      expect(setAbsence(db, leitung, { childId: lena, from: '2026-12-21', to: '2026-12-27', kind: 'vacation' }, tuesday)).toBe(0)

      const wednesday = berlin('2026-12-23', '08:00')
      arriveAt('08:00', { date: '2026-12-23', now: wednesday })
      expect(rowOf(lena, '2026-12-23', wednesday)).toMatchObject({ status: 'present', absence: null })

      expect(setAbsence(db, leitung, { childId: lena, from: '2026-12-21', to: '2026-12-27', kind: null }, wednesday)).toBe(1)
      // A past care day without anything entered is unexcused.
      expect(status('2026-12-21', wednesday)).toBe('unexcused')
      expect(errorCode(() => setAbsence(db, leitung, { childId: lena, from: '2026-12-27', to: '2026-12-21', kind: 'sick' }, wednesday)))
        .toBe('invalid_range')
    })
  })

  it('shows yesterday\'s open stay on today\'s list; yesterday counts as present, today\'s arrival works', () => {
    arriveAt('08:00', { date: YESTERDAY })
    // An open stay older than 14 days is not reported any more.
    arriveAt('08:00', { date: '2026-09-29' })
    expect(dayOf().openStays).toEqual([{ date: YESTERDAY, childId: lena, name: 'Meier, Lena' }])
    expect(rowOf(lena, YESTERDAY)).toMatchObject({ status: 'present', pickupOverdue: false })
    arriveAt('08:10')
    expect(rowOf()).toMatchObject({ status: 'present', stays: [expect.objectContaining({ arrived: hm('08:10') })] })
  })

  it('counts meals automatically and by hand, and the totals of the day', () => {
    const ben = addChild(db, 1, { lastName: 'Bauer', firstName: 'Ben' })
    const cleo = addChild(db, 1, { lastName: 'Christ', firstName: 'Cleo' })
    const dora = addChild(db, 1, { lastName: 'Dorn', firstName: 'Dora' })
    addChild(db, 1, { lastName: 'Ernst', firstName: 'Emil' })
    arriveAt('09:00', { plannedPickup: hm('13:00') }) // snack and lunch
    arriveAt('10:00', { childId: ben, plannedPickup: hm('15:00') }) // lunch only
    arriveAt('08:00', { childId: cleo, plannedPickup: hm('11:30') }) // snack only
    setAbsence(db, leitung, { childId: dora, from: TODAY, to: TODAY, kind: 'sick' }, NOW)

    const meals = () => Object.fromEntries(dayOf().children.map(child => [child.name, [child.snack, child.lunch]]))
    expect(meals()).toEqual({
      'Bauer, Ben': [false, true], 'Christ, Cleo': [true, false], 'Dorn, Dora': [false, false], 'Ernst, Emil': [false, false],
      'Meier, Lena': [true, true],
    })
    expect(dayOf()).toMatchObject({ snackTime: 570, lunchTime: 720, recordBroughtBy: false })
    expect(dayOf().counts).toEqual({ present: 3, gone: 0, absent: 1, notYet: 1, snack: 2, lunch: 2 })

    updateDay(db, leitung, { childId: ben, date: TODAY, snack: true }, NOW)
    updateDay(db, leitung, { childId: lena, date: TODAY, lunch: false }, NOW)
    expect(rowOf(ben)).toMatchObject({ snack: true, snackManual: true, lunchManual: false })
    expect(dayOf().counts).toMatchObject({ snack: 3, lunch: 1 })
    updateDay(db, leitung, { childId: ben, date: TODAY, snack: null }, NOW)
    expect(rowOf(ben)).toMatchObject({ snack: false, snackManual: false })

    leaveAt('11:00', { kind: 'contact', id: addContact(db, leitung, 1, cleo, contact({ name: 'Carla Christ' }), TODAY, NOW) }, { childId: cleo })
    expect(dayOf().counts).toMatchObject({ present: 2, gone: 1, absent: 1, notYet: 1 })

    // 15 minutes after the planned pickup (13:00) a child still here is overdue.
    expect(rowOf(lena, TODAY, berlin(TODAY, '13:14')).pickupOverdue).toBe(false)
    expect(rowOf(lena, TODAY, berlin(TODAY, '13:15')).pickupOverdue).toBe(true)
  })

  it('lists each child in the group of the day and keeps the group stored with an earlier day', () => {
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    const ben = addChild(db, 1, { lastName: 'Bauer', firstName: 'Ben', groupId: bears })
    addChild(db, 1, { lastName: 'Zorn', firstName: 'Zoe', groupId: mice })
    planGroupChange(db, leitung, 1, ben, {
      groupId: mice, date: '2026-10-20',
      keep: { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true },
    }, TODAY, NOW)
    setAbsence(db, leitung, { childId: ben, from: '2026-10-16', to: '2026-10-16', kind: 'sick' }, NOW)

    expect(rowOf(ben, '2026-10-19').groupId).toBe(bears)
    expect(rowOf(ben, '2026-10-20').groupId).toBe(mice)
    expect(rowOf(ben, '2026-10-21').groupId).toBe(mice)
    expect(db.select().from(childAttendanceDays).where(eq(childAttendanceDays.childId, ben)).get()!.groupId).toBe(bears)
    arriveAt('08:00', { childId: ben, date: '2026-10-21' })
    expect(db.select().from(childAttendanceDays).where(eq(childAttendanceDays.date, '2026-10-21')).get()!.groupId).toBe(mice)

    // The groups in their order, children without a group last; within them by name.
    const day = dayOf('2026-10-19')
    expect(day.groups).toEqual([{ id: bears, name: 'Bären' }, { id: mice, name: 'Mäuse' }, { id: null, name: '' }])
    expect(day.children.map(child => child.name)).toEqual(['Bauer, Ben', 'Zorn, Zoe', 'Meier, Lena'])
    expect(dayOf('2026-10-20').children.map(child => child.name)).toEqual(['Bauer, Ben', 'Zorn, Zoe', 'Meier, Lena'])
    expect(dayOf('2026-10-20').groups).toEqual([{ id: mice, name: 'Mäuse' }, { id: null, name: '' }])
  })

  it('knows only the facility\'s children active on the day', () => {
    const future = addChild(db, 1, { lastName: 'Zukunft', entryDate: '2026-11-01' })
    const gone = addChild(db, 1, { lastName: 'Weg', leftOn: '2026-10-01' })
    const waitlist = addChild(db, 1, { lastName: 'Vormerkung', admissionStatus: 'waitlist', entryDate: null })
    const other = addChild(db, addFacility(db, 'Krippe'), { lastName: 'Fremd' })
    for (const childId of [future, gone, waitlist, other]) {
      expect(errorCode(() => arriveAt('08:00', { childId }))).toBe('child_not_found')
      expect(errorCode(() => updateDay(db, leitung, { childId, date: TODAY, note: 'x' }, NOW))).toBe('child_not_found')
      expect(errorCode(() => attendanceHistory(db, leitung, childId, TODAY))).toBe('child_not_found')
    }
    expect(dayOf().children.map(child => child.childId)).toEqual([lena])
    // Before leaving the child was active.
    arriveAt('08:00', { childId: gone, date: '2026-09-30' })
    expect(dayOf('2026-09-30').children.map(child => child.name)).toEqual(['Meier, Lena', 'Weg, Kind'])
  })

  it('corrects and deletes stays, with the same rules', () => {
    arriveAt('08:00')
    leaveAt('15:00', mamaPickup())
    const stayId = rowOf().stays[0]!.id
    updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: hm('15:05') }, NOW)
    expect(rowOf().stays[0]).toMatchObject({ arrived: hm('07:50'), left: hm('15:05'), pickedUpBy: 'Anna Meier' })
    expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: hm('15:10'), left: hm('15:05') }, NOW))).toBe('leave_before_arrival')
    expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: hm('15:05'), pickup: { kind: 'contact', id: opa } }, NOW)))
      .toBe('pickup_person_invalid')
    expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: hm('15:05'), pickup: { kind: 'contact', id: papa } }, NOW)))
      .toBe('pickup_person_invalid')

    // Opened again: nobody picked the child up; closing it needs a person again.
    updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: null }, NOW)
    expect(rowOf().stays[0]).toMatchObject({ left: null, pickedUpBy: null })
    expect(db.select().from(childAttendanceStays).get()!.pickedUpContactId).toBeNull()
    expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: hm('15:05') }, NOW))).toBe('pickup_person_required')
    updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: hm('15:05'), pickup: mamaPickup() }, NOW)

    arriveAt('16:00')
    expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: hm('07:50'), left: null }, NOW))).toBe('already_present')

    deleteStay(db, leitung, stayId, NOW)
    expect(rowOf().stays.map(stay => stay.arrived)).toEqual([hm('16:00')])
    expect(errorCode(() => deleteStay(db, leitung, stayId, NOW))).toBe('stay_not_found')
    expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: 0, left: null }, NOW))).toBe('stay_not_found')
  })

  it('logs every change with the person, also for a tablet person without account', () => {
    const berta = addEmployee(db, 'Berta Beispiel')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, berta, '4321')
    const tablet = addUser(db, 'tablet', 'terminal')
    const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, berta, '4321', NOW).token
    const atTablet = resolveChildViewer(db, tablet, token, NOW)
    expect(atTablet).toMatchObject({ id: null, employeeId: berta, name: 'Berta Beispiel' })

    updateDay(db, atTablet, { childId: lena, date: TODAY, note: 'hingefallen' }, NOW)
    expect(rowOf().changed).toBe(false)
    const later = berlin(TODAY, '11:30')
    updateDay(db, atTablet, { childId: lena, date: TODAY, note: 'hingefallen, Knie gekühlt' }, later)
    expect(rowOf()).toMatchObject({ note: 'hingefallen, Knie gekühlt', changed: true })

    expect(attendanceHistory(db, atTablet, lena, TODAY)).toEqual([
      { id: expect.any(Number), field: 'note', before: 'hingefallen', after: 'hingefallen, Knie gekühlt', changedAt: later.toISOString(), changedByName: 'Berta Beispiel' },
      { id: expect.any(Number), field: 'note', before: '', after: 'hingefallen', changedAt: NOW.toISOString(), changedByName: 'Berta Beispiel' },
    ])
    expect(db.select().from(childAttendanceChanges).all().map(row => [row.changedByUserId, row.changedByEmployeeId, row.changedByName]))
      .toEqual([[null, berta, 'Berta Beispiel'], [null, berta, 'Berta Beispiel']])

    // One row per changed field; an unchanged field is not logged.
    arrive(db, atTablet, { childId: lena, date: TODAY, time: hm('08:00'), plannedPickup: hm('15:00') }, NOW)
    leave(db, atTablet, { childId: lena, date: TODAY, time: hm('12:00'), pickup: mamaPickup() }, NOW)
    expect(attendanceHistory(db, leitung, lena, TODAY).map(entry => [entry.field, entry.before, entry.after]).reverse()).toEqual([
      ['note', '', 'hingefallen'], ['note', 'hingefallen', 'hingefallen, Knie gekühlt'],
      ['arrived', '', '8:00'], ['plannedPickup', '', '15:00'],
      ['left', '', '12:00'], ['pickedUpBy', '', 'Anna Meier'],
    ])
    updateDay(db, leitung, { childId: lena, date: TODAY, note: 'hingefallen, Knie gekühlt', snack: false }, NOW)
    expect(attendanceHistory(db, leitung, lena, TODAY)[0]).toMatchObject({ field: 'snack', before: '', after: 'false', changedByName: 'leitung' })
    expect(attendanceHistory(db, leitung, lena, YESTERDAY)).toEqual([])
  })

  it('goes with the child record', () => {
    arriveAt('08:00')
    announcePickup(db, leitung, { childId: lena, date: TODAY, name: 'Oma Erika', announcedBy: '' }, NOW)
    db.insert(childAttendanceMonths).values({ childId: lena, month: '2026-10', remark: 'Eingewöhnung' }).run()
    expect(db.select().from(childAttendanceChanges).all().length).toBeGreaterThan(0)

    deleteChild(db, 1, lena)

    for (const table of [childAttendanceDays, childAttendanceStays, childPickupAnnouncements, childAttendanceMonths, childAttendanceChanges]) {
      expect(db.select().from(table).all()).toEqual([])
    }
  })
})
