import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  careTypes, childAttendanceChanges, childAttendanceDays, childAttendanceMonths, childAttendanceStays, childContacts, childPickupAnnouncements,
  children, closures,
} from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import { attendanceArriveSchema, attendanceLeaveSchema } from '../../server/schemas'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import {
  announcePickup, arrive, attendanceHistory, deleteStay, getAttendanceDay, getAttendanceMonth, getAttendanceSettings, leave,
  removeAnnouncement, setAbsence, setAttendanceSettings, setMonthRemark, updateDay, updateStay,
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
  /** Sets the day attendance is recorded from, as Leitung does under Einstellungen → Anwesenheit. */
  const recordFrom = (attendanceSince: string | null, facilityId = 1) =>
    setAttendanceSettings(db, facilityId, { ...getAttendanceSettings(db, facilityId), attendanceSince })
  const since = (facilityId = 1) => getAttendanceSettings(db, facilityId).attendanceSince

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

  it('answers a missing planned pickup or pickup person with its own hint, not a generic error', () => {
    const arriveBody = attendanceArriveSchema.parse({ childId: lena, date: TODAY, time: hm('08:00') })
    expect(errorCode(() => arrive(db, leitung, arriveBody, NOW))).toBe('planned_pickup_required')
    arriveAt('08:00')
    const leaveBody = attendanceLeaveSchema.parse({ childId: lena, date: TODAY, time: hm('15:00') })
    expect(errorCode(() => leave(db, leitung, leaveBody, NOW))).toBe('pickup_person_required')
    // Sent as null, the same.
    expect(errorCode(() => leave(db, leitung, attendanceLeaveSchema.parse({ ...leaveBody, pickup: null }), NOW))).toBe('pickup_person_required')
  })

  describe('a later day', () => {
    const TOMORROW = '2026-10-15'

    it('cannot be stamped in or out or get stay times; absences and announcements ahead are fine', () => {
      expect(errorCode(() => arriveAt('08:00', { date: TOMORROW }))).toBe('attendance_future')
      expect(errorCode(() => leaveAt('15:00', mamaPickup(), { date: TOMORROW }))).toBe('attendance_future')
      expect(db.select().from(childAttendanceStays).all()).toEqual([])

      // A stay of a later day (as it could be stored before this rule) cannot be corrected.
      const dayId = db.insert(childAttendanceDays).values({ childId: lena, date: TOMORROW }).returning().get().id
      const stayId = db.insert(childAttendanceStays).values({ dayId, arrived: hm('08:00') }).returning().get().id
      expect(errorCode(() => updateStay(db, leitung, stayId, { arrived: hm('08:00'), left: hm('15:00'), pickup: mamaPickup() }, NOW)))
        .toBe('attendance_future')
      deleteStay(db, leitung, stayId, NOW)

      expect(setAbsence(db, leitung, { childId: lena, from: TOMORROW, to: TOMORROW, kind: 'vacation' }, NOW)).toBe(1)
      announcePickup(db, leitung, { childId: lena, date: TOMORROW, name: 'Oma Erika', announcedBy: '' }, NOW)
      expect(rowOf(lena, TOMORROW)).toMatchObject({ status: 'vacation', announcements: [expect.objectContaining({ name: 'Oma Erika' })] })
    })

    it('is the next day in Berlin, also late in the evening', () => {
      const lateEvening = berlin(TODAY, '23:30')
      expect(errorCode(() => arriveAt('08:00', { date: TOMORROW, now: lateEvening }))).toBe('attendance_future')
      arriveAt('23:30', { now: lateEvening })
      const afterMidnight = berlin(TOMORROW, '00:10') // 22:10 UTC on the 14th, but the 15th in Berlin
      arriveAt('00:10', { date: TOMORROW, now: afterMidnight })
      expect(rowOf(lena, TOMORROW, afterMidnight).status).toBe('present')
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

    it('suggests the end of the care type and offers the contacts without a ban as brought-by', () => {
      expect(rowOf().careEnd).toBeNull()
      const care = db.insert(careTypes).values({ facilityId: 1, name: 'Ganztag', start: hm('07:00'), end: hm('16:30') }).returning().get().id
      db.update(children).set({ careTypeId: care }).where(eq(children.id, lena)).run()
      const row = rowOf()
      expect(row.careEnd).toBe(hm('16:30'))
      expect(row.bringOptions).toEqual(['Anna Meier', 'Opa Karl'])
    })
  })

  describe('absences', () => {
    it('go only to care days without a stay; a later arrival replaces the absence of that day', () => {
      // Monday 21 to Sunday 27 December 2026: 24th a closure day, 25th and 26th public holidays, the weekend.
      db.insert(closures).values({ facilityId: 1, startDate: '2026-12-24', endDate: '2026-12-24', label: 'Heiligabend', mode: 'closure_day' }).run()
      recordFrom('2026-12-01')
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

  it('does not report an open stay of the facility the child came from', () => {
    const nina = addChild(db, 1, { lastName: 'Neu', firstName: 'Nina' })
    db.update(children).set({ facilitySince: '2026-10-12' }).where(eq(children.id, nina)).run()
    // Left open in the old facility before the move; the stay stays with the child.
    const oldDay = db.insert(childAttendanceDays).values({ childId: nina, date: '2026-10-09' }).returning().get().id
    db.insert(childAttendanceStays).values({ dayId: oldDay, arrived: hm('08:00') }).run()
    expect(dayOf().openStays).toEqual([])
    arriveAt('08:00', { childId: nina, date: '2026-10-12' })
    expect(dayOf().openStays).toEqual([{ date: '2026-10-12', childId: nina, name: 'Neu, Nina' }])
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
    arriveAt('08:00', { childId: ben, date: '2026-10-21', now: berlin('2026-10-21', '08:00') })
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

  it('refuses stays of a day that overlap; stays that only touch are fine', () => {
    arriveAt('08:00')
    leaveAt('10:00', mamaPickup())
    expect(errorCode(() => arriveAt('09:59'))).toBe('stays_overlap')
    expect(errorCode(() => arriveAt('07:00'))).toBe('stays_overlap')
    arriveAt('11:00')
    leaveAt('12:00', mamaPickup())
    const [first, second] = rowOf().stays.map(stay => stay.id) as [number, number]

    const correct = (stayId: number, arrived: string, left: string | null) =>
      updateStay(db, leitung, stayId, { arrived: hm(arrived), left: left === null ? null : hm(left) }, NOW)
    expect(errorCode(() => correct(second, '09:30', '12:00'))).toBe('stays_overlap')
    expect(errorCode(() => correct(first, '08:00', '11:30'))).toBe('stays_overlap')
    expect(errorCode(() => correct(first, '11:15', '11:45'))).toBe('stays_overlap')
    expect(errorCode(() => correct(first, '07:00', '13:00'))).toBe('stays_overlap')
    // Opened again, the first stay would last into the second.
    expect(errorCode(() => correct(first, '08:00', null))).toBe('stays_overlap')
    expect(rowOf().stays.map(stay => [stay.arrived, stay.left])).toEqual([[hm('08:00'), hm('10:00')], [hm('11:00'), hm('12:00')]])

    correct(first, '08:00', '11:00')
    correct(second, '11:00', null)
    expect(rowOf().stays.map(stay => [stay.arrived, stay.left])).toEqual([[hm('08:00'), hm('11:00')], [hm('11:00'), null]])
    // An arrival after the open stay is still already_present.
    expect(errorCode(() => arriveAt('13:00'))).toBe('already_present')
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

  describe('month overview', () => {
    const monthOf = (year = 2026, month = 10, now = NOW) => getAttendanceMonth(db, leitung, year, month, now)
    const rowsOf = (childId: number, year = 2026, month = 10, now = NOW) =>
      monthOf(year, month, now).groups.flatMap(group => group.children.filter(child => child.childId === childId).map(child => ({ group, child })))
    const oct = (day: number) => `2026-10-${String(day).padStart(2, '0')}`
    const dayNumbers = (cells: Record<string, unknown>) => Object.keys(cells).map(date => Number(date.slice(8)))
    const move = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }

    it('shows present, sick, vacation, excused and unexcused days with sums; today and the future stay empty', () => {
      // Thursday 1 October: here; Friday 2nd: sick; Mon 5th: vacation; Tue 6th: excused; Thu 8th: came and went home.
      arriveAt('08:00', { date: oct(1) })
      setAbsence(db, leitung, { childId: lena, from: oct(2), to: oct(2), kind: 'sick' }, NOW)
      setAbsence(db, leitung, { childId: lena, from: oct(5), to: oct(5), kind: 'vacation' }, NOW)
      setAbsence(db, leitung, { childId: lena, from: oct(6), to: oct(6), kind: 'excused' }, NOW)
      arriveAt('08:00', { date: oct(8) })
      leave(db, leitung, { childId: lena, date: oct(8), time: hm('15:00'), pickup: mamaPickup() }, NOW)

      const month = monthOf()
      expect(month).toMatchObject({ year: 2026, month: 10 })
      expect(month.days).toHaveLength(31)
      expect(month.days[0]).toEqual({ date: oct(1), grey: false })
      expect(month.days.filter(day => day.grey).map(day => day.date)).toEqual([3, 4, 10, 11, 17, 18, 24, 25, 31].map(oct))
      expect(month.groups).toHaveLength(1)
      expect(month.groups[0]).toMatchObject({ id: null, name: '' })
      const row = month.groups[0]!.children[0]!
      expect(row).toMatchObject({ childId: lena, name: 'Meier, Lena', remark: '' })
      expect(row.cells[oct(1)]).toBe('present')
      expect(row.cells[oct(2)]).toBe('sick')
      expect(row.cells[oct(5)]).toBe('vacation')
      expect(row.cells[oct(6)]).toBe('excused')
      expect(row.cells[oct(7)]).toBe('unexcused')
      expect(row.cells[oct(8)]).toBe('present') // picked up counts as present
      expect(row.cells[oct(9)]).toBe('unexcused')
      expect(row.cells[oct(3)]).toBe('none') // weekend
      expect(row.cells[oct(14)]).toBe('none') // today
      expect(row.cells[oct(20)]).toBe('none') // future
      expect(Object.keys(row.cells)).toHaveLength(31)
      // Unexcused: the past care days 7, 9, 12 and 13 October.
      expect(row.sums).toEqual({ present: 2, sick: 1, vacation: 1, excused: 1, unexcused: 4 })
    })

    it('greys weekends, public holidays and closure days', () => {
      db.insert(closures).values({ facilityId: 1, startDate: '2026-12-24', endDate: '2026-12-24', label: 'Heiligabend', mode: 'closure_day' }).run()
      const month = monthOf(2026, 12)
      expect(month.days).toHaveLength(31)
      expect(month.days.filter(day => day.grey).map(day => Number(day.date.slice(8)))).toEqual([5, 6, 12, 13, 19, 20, 24, 25, 26, 27])
      expect(monthOf(2026, 2).days).toHaveLength(28)
    })

    it('puts a child in both groups after a group change, each with its own days', () => {
      const bears = addGroup(db, 1, 'Bären')
      const mice = addGroup(db, 1, 'Mäuse')
      const ben = addChild(db, 1, { lastName: 'Bauer', firstName: 'Ben', groupId: bears })
      planGroupChange(db, leitung, 1, ben, { groupId: mice, date: oct(20), keep: move }, TODAY, NOW)
      recordFrom(oct(1))
      setAbsence(db, leitung, { childId: ben, from: oct(19), to: oct(19), kind: 'sick' }, NOW)
      // The stored group of an attendance day does not decide; the group history does.
      db.update(childAttendanceDays).set({ groupId: mice }).where(eq(childAttendanceDays.childId, ben)).run()

      const month = monthOf(2026, 10, berlin('2026-10-30', '10:00'))
      expect(month.groups.map(group => [group.id, group.name, group.children.map(child => child.name)]))
        .toEqual([[bears, 'Bären', ['Bauer, Ben']], [mice, 'Mäuse', ['Bauer, Ben']], [null, '', ['Meier, Lena']]])
      const inBears = month.groups[0]!.children[0]!
      const inMice = month.groups[1]!.children[0]!
      expect(dayNumbers(inBears.cells)).toEqual(Array.from({ length: 19 }, (_, index) => index + 1))
      expect(dayNumbers(inMice.cells)).toEqual(Array.from({ length: 12 }, (_, index) => index + 20))
      expect(inBears.cells[oct(19)]).toBe('sick')
      expect(inBears.sums).toMatchObject({ sick: 1, unexcused: 12 })
      expect(inMice.sums).toMatchObject({ sick: 0, unexcused: 8 })
    })

    it('has no cells before the entry, after leaving or before the child moved to this facility', () => {
      const eva = addChild(db, 1, { lastName: 'Ernst', firstName: 'Eva', entryDate: oct(12), leftOn: oct(20) })
      const moved = addChild(db, 1, { lastName: 'Neu', firstName: 'Nina' })
      db.update(children).set({ facilitySince: oct(10) }).where(eq(children.id, moved)).run()
      // Days of the old facility stay with the child but are not shown here.
      db.insert(childAttendanceDays).values({ childId: moved, date: oct(5), absence: 'sick' }).run()
      setAbsence(db, leitung, { childId: moved, from: oct(12), to: oct(12), kind: 'vacation' }, NOW)

      const later = berlin('2026-10-30', '10:00')
      expect(dayNumbers(rowsOf(eva, 2026, 10, later)[0]!.child.cells)).toEqual(Array.from({ length: 9 }, (_, index) => index + 12))
      const movedCells = rowsOf(moved, 2026, 10, later)[0]!.child.cells
      expect(dayNumbers(movedCells)).toEqual(Array.from({ length: 22 }, (_, index) => index + 10))
      expect(movedCells[oct(5)]).toBeUndefined()
      expect(movedCells[oct(12)]).toBe('vacation')
      // A child who is active on no day of the month is not listed at all.
      const future = addChild(db, 1, { lastName: 'Zukunft', entryDate: '2026-11-01' })
      expect(rowsOf(future)).toEqual([])
      expect(rowsOf(eva, 2026, 11)).toEqual([])
      expect(monthOf(2024, 1).groups).toEqual([])
    })

    it('stores the remark of a child and month and logs it on the first day of the month', () => {
      const ben = addChild(db, 1, { lastName: 'Bauer', firstName: 'Ben' })
      setMonthRemark(db, leitung, { childId: lena, month: '2026-10', remark: '  Eingewöhnung  ' }, NOW)
      expect(rowsOf(lena)[0]!.child.remark).toBe('Eingewöhnung')
      expect(rowsOf(ben)[0]!.child.remark).toBe('')
      expect(rowsOf(lena, 2026, 11)[0]!.child.remark).toBe('')

      const later = berlin(TODAY, '11:00')
      setMonthRemark(db, leitung, { childId: lena, month: '2026-10', remark: 'Eingewöhnung beendet' }, later)
      setMonthRemark(db, leitung, { childId: lena, month: '2026-10', remark: 'Eingewöhnung beendet' }, later)
      expect(rowsOf(lena)[0]!.child.remark).toBe('Eingewöhnung beendet')
      expect(db.select().from(childAttendanceMonths).all()).toHaveLength(1)
      expect(db.select().from(childAttendanceChanges).all().map(row => [row.childId, row.date, row.field, row.before, row.after, row.changedByName]))
        .toEqual([
          [lena, '2026-10-01', 'monthRemark', '', 'Eingewöhnung', 'leitung'],
          [lena, '2026-10-01', 'monthRemark', 'Eingewöhnung', 'Eingewöhnung beendet', 'leitung'],
        ])
      // The remark is no entry of the day: the list does not mark the first of the month as changed.
      expect(rowOf(lena, '2026-10-01').changed).toBe(false)

      const other = addChild(db, addFacility(db, 'Krippe'), { lastName: 'Fremd' })
      const future = addChild(db, 1, { lastName: 'Zukunft', entryDate: '2026-11-01' })
      expect(errorCode(() => setMonthRemark(db, leitung, { childId: other, month: '2026-10', remark: 'x' }, NOW))).toBe('child_not_found')
      expect(errorCode(() => setMonthRemark(db, leitung, { childId: future, month: '2026-10', remark: 'x' }, NOW))).toBe('child_not_found')
      expect(errorCode(() => setMonthRemark(db, leitung, { childId: lena, month: '2026-13', remark: 'x' }, NOW))).toBe('invalid_input')
    })
  })

  describe('settings', () => {
    it('start with 09:30, 12:00, no brought-by and no recording yet, and accept times of the day', () => {
      expect(getAttendanceSettings(db, 1)).toEqual({ snackTime: 570, lunchTime: 720, recordBroughtBy: false, attendanceSince: null })
      setAttendanceSettings(db, 1, { snackTime: hm('09:45'), lunchTime: hm('11:30'), recordBroughtBy: true, attendanceSince: '2026-10-01' })
      expect(getAttendanceSettings(db, 1)).toEqual({ snackTime: 585, lunchTime: 690, recordBroughtBy: true, attendanceSince: '2026-10-01' })
      expect(dayOf()).toMatchObject({ snackTime: 585, lunchTime: 690, recordBroughtBy: true })
      setAttendanceSettings(db, 1, { snackTime: 0, lunchTime: 1439, recordBroughtBy: false, attendanceSince: null })
      expect(getAttendanceSettings(db, 1)).toEqual({ snackTime: 0, lunchTime: 1439, recordBroughtBy: false, attendanceSince: null })
    })

    it('refuse times outside 0–1439 and invalid dates, and belong to one facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const valid = { snackTime: 570, lunchTime: 720, recordBroughtBy: false, attendanceSince: null }
      for (const snackTime of [-1, 1440, 9.5, Number.NaN]) {
        expect(errorCode(() => setAttendanceSettings(db, 1, { ...valid, snackTime }))).toBe('attendance_time_invalid')
      }
      expect(errorCode(() => setAttendanceSettings(db, 1, { ...valid, lunchTime: 1440 }))).toBe('attendance_time_invalid')
      for (const attendanceSince of ['2026-02-30', '14.10.2026', '']) {
        expect(errorCode(() => setAttendanceSettings(db, 1, { ...valid, attendanceSince }))).toBe('invalid_date')
      }
      expect(getAttendanceSettings(db, 1)).toEqual(valid)
      setAttendanceSettings(db, krippe, { snackTime: 600, lunchTime: 700, recordBroughtBy: true, attendanceSince: '2026-09-01' })
      expect(getAttendanceSettings(db, 1)).toEqual(valid)
      expect(errorCode(() => getAttendanceSettings(db, 9999))).toBe('facility_not_found')
    })
  })

  describe('recording start (Anwesenheit erfasst ab)', () => {
    const oct = (day: number) => `2026-10-${String(day).padStart(2, '0')}`
    const lenaMonth = (now = NOW) => getAttendanceMonth(db, leitung, 2026, 10, now).groups[0]!.children.find(child => child.childId === lena)!

    it('shows nothing as unexcused while nothing was ever recorded', () => {
      const later = berlin('2026-10-30', '10:00')
      expect(since()).toBeNull()
      const row = lenaMonth(later)
      expect(Object.values(row.cells).every(cell => cell === 'none')).toBe(true)
      expect(row.sums).toEqual({ present: 0, sick: 0, vacation: 0, excused: 0, unexcused: 0 })
      expect(rowOf(lena, YESTERDAY).status).toBe('not_yet')
      expect(dayOf(YESTERDAY).counts).toMatchObject({ absent: 0, notYet: 1 })
    })

    it('starts on the go-live day: earlier care days stay empty and are not counted', () => {
      const ben = addChild(db, 1, { lastName: 'Bauer', firstName: 'Ben' })
      arriveAt('08:00') // the first entry ever, today (14 October)
      expect(since()).toBe(TODAY)

      // Seen from the 16th: the 15th is unexcused, the days before the go-live are not.
      const friday = berlin('2026-10-16', '10:00')
      const row = lenaMonth(friday)
      expect([oct(1), oct(7), oct(13)].map(date => row.cells[date])).toEqual(['none', 'none', 'none'])
      expect(row.cells[oct(14)]).toBe('present')
      expect(row.cells[oct(15)]).toBe('unexcused')
      expect(row.sums).toEqual({ present: 1, sick: 0, vacation: 0, excused: 0, unexcused: 1 })
      expect(rowOf(ben, YESTERDAY, friday).status).toBe('not_yet')
      expect(dayOf(YESTERDAY, friday).counts).toMatchObject({ absent: 0, notYet: 2 })
      expect(rowOf(ben, oct(15), friday).status).toBe('unexcused')
      expect(dayOf(oct(15), friday).counts).toMatchObject({ absent: 2, notYet: 0 })

      // Another facility has its own start.
      const krippe = addFacility(db, 'Krippe')
      expect(since(krippe)).toBeNull()
    })

    it('is set by the first write of any kind, to its day or today if that is earlier, and then kept', () => {
      const writes: [string, () => void][] = [
        ['absence ahead', () => setAbsence(db, leitung, { childId: lena, from: oct(19), to: oct(23), kind: 'vacation' }, NOW)],
        ['arrival yesterday', () => arriveAt('08:00', { date: YESTERDAY })],
        ['absence range', () => setAbsence(db, leitung, { childId: lena, from: oct(8), to: oct(9), kind: 'sick' }, NOW)],
        ['announcement', () => announcePickup(db, leitung, { childId: lena, date: oct(12), name: 'Oma Erika', announcedBy: '' }, NOW)],
        ['note', () => updateDay(db, leitung, { childId: lena, date: oct(12), note: 'müde' }, NOW)],
        ['meal', () => updateDay(db, leitung, { childId: lena, date: oct(12), lunch: false }, NOW)],
        ['month remark', () => setMonthRemark(db, leitung, { childId: lena, month: '2026-10', remark: 'Eingewöhnung' }, NOW)],
      ]
      const expected = { 'absence ahead': TODAY, 'arrival yesterday': YESTERDAY, 'absence range': oct(8), 'announcement': oct(12), 'note': oct(12), 'meal': oct(12), 'month remark': TODAY }
      for (const [name, write] of writes) {
        recordFrom(null)
        write()
        expect(since(), name).toBe(expected[name as keyof typeof expected])
      }

      // Once set, a later write for an earlier day does not move it.
      recordFrom(null)
      arriveAt('08:00', { date: oct(12) })
      setAbsence(db, leitung, { childId: lena, from: oct(5), to: oct(5), kind: 'sick' }, NOW)
      expect(since()).toBe(oct(12))
      expect(lenaMonth().cells[oct(5)]).toBe('sick') // the entry still shows
      expect(lenaMonth().cells[oct(6)]).toBe('none')
    })

    it('respects the day set by hand', () => {
      recordFrom(oct(1))
      arriveAt('08:00')
      expect(since()).toBe(oct(1))
      expect(lenaMonth().cells[oct(7)]).toBe('unexcused')
      expect(lenaMonth().sums.unexcused).toBe(9)
    })
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
