import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asc, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges, children } from '../../server/db/schema'
import { setChildRetentionYears } from '../../server/services/appSettings'
import {
  applyDueGroupChanges, deleteGroupChange, planGroupChange, updateGroupChange,
} from '../../server/services/childGroupChanges'
import {
  createChild, getChild, leaveChild, listArchive, moveChildToFacility, unleaveChild, updateChildMaster,
} from '../../server/services/children'
import { deleteGroup, listGroups, setGroupForSchoolChildren } from '../../server/services/groups'
import {
  getSchoolSettings, leaveSchoolChildren, occupancyChildren, schoolLeavers, setAutoLeave, setSchoolCutoff,
} from '../../server/services/schoolChildren'
import type { ChildActor } from '../../server/lib/childViewer'
import type { ChildMasterInput, GroupChangeInput } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')
const KEEP_ALL = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }
/** Born on the default cutoff (30 June, six years): the school start is 1 September 2027. */
const BORN_ON_CUTOFF = '2021-06-30'
const SCHOOL_START = '2027-09-01'
const DAY_BEFORE = '2027-08-31'

const BW_CUTOFF = { cutoffMonth: 6, cutoffDay: 30, ageYears: 6 }

describe('school settings of a facility', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('starts with 30 June and six years', () => {
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: false, stateCutoff: BW_CUTOFF })
  })

  it('stores the cutoff per facility', () => {
    const krippe = addFacility(db, 'Krippe')
    setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 30, ageYears: 5 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 9, cutoffDay: 30, ageYears: 5, autoLeave: false, stateCutoff: BW_CUTOFF })
    expect(getSchoolSettings(db, krippe)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: false, stateCutoff: BW_CUTOFF })
  })

  it('accepts 29 February and the age limits 4 and 8', () => {
    setSchoolCutoff(db, 1, { cutoffMonth: 2, cutoffDay: 29, ageYears: 4 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 2, cutoffDay: 29, ageYears: 4, autoLeave: false, stateCutoff: BW_CUTOFF })
    setSchoolCutoff(db, 1, { cutoffMonth: 12, cutoffDay: 31, ageYears: 8 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 12, cutoffDay: 31, ageYears: 8, autoLeave: false, stateCutoff: BW_CUTOFF })
  })

  it.each([
    ['31 June', { cutoffMonth: 6, cutoffDay: 31, ageYears: 6 }],
    ['30 February', { cutoffMonth: 2, cutoffDay: 30, ageYears: 6 }],
    ['month 13', { cutoffMonth: 13, cutoffDay: 1, ageYears: 6 }],
    ['month 0', { cutoffMonth: 0, cutoffDay: 1, ageYears: 6 }],
    ['day 0', { cutoffMonth: 6, cutoffDay: 0, ageYears: 6 }],
    ['age 3', { cutoffMonth: 6, cutoffDay: 30, ageYears: 3 }],
    ['age 9', { cutoffMonth: 6, cutoffDay: 30, ageYears: 9 }],
    ['age 5.5', { cutoffMonth: 6, cutoffDay: 30, ageYears: 5.5 }],
    ['day 15.5', { cutoffMonth: 6, cutoffDay: 15.5, ageYears: 6 }],
  ])('refuses %s', (_label, input) => {
    expect(errorCode(() => setSchoolCutoff(db, 1, input))).toBe('invalid_school_cutoff')
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: false, stateCutoff: BW_CUTOFF })
  })

  it('shows the computed school start in the record, for managers and Mitarbeiter, following the cutoff', () => {
    const admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const staff = asChildViewer(addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')))
    const id = addChild(db, 1, { birthDate: '2021-07-01' })
    expect(getChild(db, admin, id, TODAY).computedSchoolStart).toBe('2028-09-01')
    setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
    expect(getChild(db, admin, id, TODAY).computedSchoolStart).toBe('2027-09-01')
    expect(getChild(db, staff, id, TODAY).computedSchoolStart).toBe('2027-09-01')
  })

  it('keeps the manual school start separate from the computed one', () => {
    const admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const id = addChild(db, 1, { birthDate: '2021-06-30', schoolStartDate: '2028-09-01' })
    const record = getChild(db, admin, id, TODAY)
    expect(record.master.schoolStartDate).toBe('2028-09-01')
    expect(record.computedSchoolStart).toBe('2027-09-01')
  })
})

describe('children for the occupancy table', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('lists contract children of the facility with stay borders, archived ones included', () => {
    const bears = addGroup(db, 1, 'Bären')
    const krippe = addFacility(db, 'Krippe')
    const planned = addChild(db, 1, {
      firstName: 'Lena', lastName: 'Meier', birthDate: '2021-06-30', entryDate: null, plannedEntryDate: '2026-11-01', groupId: bears,
    })
    const left = addChild(db, 1, { firstName: 'Ben', lastName: 'Arnold', entryDate: '2025-09-01', leftOn: '2026-03-15' })
    const manual = addChild(db, 1, { firstName: 'Zoe', lastName: 'Klein', birthDate: '2021-06-30', schoolStartDate: '2028-09-01' })
    addChild(db, 1, { admissionStatus: 'waitlist', entryDate: null })
    addChild(db, krippe, { firstName: 'Fremd' })

    const result = occupancyChildren(db, 1)

    // In the order last name, first name: Arnold, Klein, Meier.
    expect(result.children.map(child => child.id)).toEqual([left, manual, planned])
    const byId = new Map(result.children.map(child => [child.id, child]))
    // Born on the cutoff: school start 1 September 2027, so the stay ends on 31 August 2027.
    expect(byId.get(planned)).toEqual({ id: planned, start: '2026-11-01', end: '2027-08-31', groups: [{ from: null, groupId: bears }] })
    // A recorded leaving day wins over the school start.
    expect(byId.get(left)).toMatchObject({ start: '2025-09-01', end: '2026-03-15', groups: [{ from: null, groupId: null }] })
    // A later manual school start moves the end.
    expect(byId.get(manual)).toMatchObject({ end: '2028-08-31' })
    expect(result.names).toEqual({ [planned]: 'Lena Meier', [left]: 'Ben Arnold', [manual]: 'Zoe Klein' })
    expect(result.undated).toEqual([])
    expect(result.inconsistent).toEqual([])
  })

  it('orders by last name, first name, then id', () => {
    const second = addChild(db, 1, { firstName: 'Ida', lastName: 'Müller' })
    const third = addChild(db, 1, { firstName: 'Ida', lastName: 'Müller' })
    const first = addChild(db, 1, { firstName: 'Zoe', lastName: 'Adler' })
    const last = addChild(db, 1, { firstName: 'Ben', lastName: 'Zeller' })
    expect(occupancyChildren(db, 1).children.map(child => child.id)).toEqual([first, second, third, last])
  })

  it('reports contract children without a start as undated and does not count them', () => {
    const nameless = addChild(db, 1, { firstName: 'Mia', lastName: 'Weber', entryDate: null, plannedEntryDate: null })
    const first = addChild(db, 1, { firstName: 'Ole', lastName: 'Adam', entryDate: null, plannedEntryDate: null })
    addChild(db, 1, { firstName: 'Vorgemerkt', admissionStatus: 'waitlist', entryDate: null })
    const result = occupancyChildren(db, 1)
    expect(result.undated).toEqual([{ id: first, name: 'Ole Adam' }, { id: nameless, name: 'Mia Weber' }])
    expect(result.inconsistent).toEqual([])
    expect(result.children.find(child => child.id === nameless)?.start).toBeNull()
  })

  it('reports children whose stay ends before it starts as inconsistent, not as undated', () => {
    const tooOld = addChild(db, 1, { firstName: 'Max', lastName: 'Zander', birthDate: '2015-01-01', entryDate: '2026-09-01' })
    const leftEarly = addChild(db, 1, { firstName: 'Ida', lastName: 'Adler', entryDate: '2026-10-01', leftOn: '2026-09-15' })
    addChild(db, 1, { firstName: 'Eva', lastName: 'Klein', birthDate: '2024-01-01', entryDate: '2026-10-01', leftOn: '2026-10-01' })
    const result = occupancyChildren(db, 1)
    expect(result.inconsistent).toEqual([{ id: leftEarly, name: 'Ida Adler' }, { id: tooOld, name: 'Max Zander' }])
    expect(result.undated).toEqual([])
  })

  it('uses the facility\'s own cutoff', () => {
    const id = addChild(db, 1, { birthDate: '2021-07-01' })
    expect(occupancyChildren(db, 1).children.find(child => child.id === id)?.end).toBe('2028-08-31')
    setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
    expect(occupancyChildren(db, 1).children.find(child => child.id === id)?.end).toBe('2027-08-31')
  })
})

describe('groups for school children', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('flags a group as being for school children, per group', () => {
    const bears = addGroup(db, 1, 'Bären')
    const hort = addGroup(db, 1, 'Hort')
    expect(listGroups(db, 1).map(group => group.forSchoolChildren)).toEqual([false, false])
    setGroupForSchoolChildren(db, hort, true)
    expect(listGroups(db, 1).map(group => [group.id, group.forSchoolChildren])).toEqual([[bears, false], [hort, true]])
    setGroupForSchoolChildren(db, hort, false)
    expect(listGroups(db, 1).map(group => group.forSchoolChildren)).toEqual([false, false])
  })

  it('answers group_not_found for an unknown group', () => {
    expect(errorCode(() => setGroupForSchoolChildren(db, 999, true))).toBe('group_not_found')
  })

  it('leaves the stay of a child open that is in such a group on its school start, so it is no longer inconsistent', () => {
    const bears = addGroup(db, 1, 'Bären')
    const hort = addGroup(db, 1, 'Hort')
    // Already of school age when it starts: without a group for school children its stay would end before it starts.
    const old = addChild(db, 1, { firstName: 'Max', lastName: 'Zander', birthDate: '2019-01-01', entryDate: '2026-09-01', groupId: hort })
    const young = addChild(db, 1, { firstName: 'Ida', lastName: 'Adler', birthDate: BORN_ON_CUTOFF, groupId: bears })
    expect(occupancyChildren(db, 1).inconsistent).toEqual([{ id: old, name: 'Max Zander' }])

    setGroupForSchoolChildren(db, hort, true)

    const result = occupancyChildren(db, 1)
    expect(result.inconsistent).toEqual([])
    expect(result.children.find(child => child.id === old)).toMatchObject({ start: '2026-09-01', end: null })
    expect(result.children.find(child => child.id === young)).toMatchObject({ end: DAY_BEFORE })
  })

  it('ends the stay on the leaving day, also for a child in a group for school children', () => {
    const hort = addGroup(db, 1, 'Hort')
    setGroupForSchoolChildren(db, hort, true)
    const id = addChild(db, 1, { birthDate: '2019-01-01', entryDate: '2026-09-01', groupId: hort, leftOn: '2027-07-31' })
    expect(occupancyChildren(db, 1).children.find(child => child.id === id)).toMatchObject({ end: '2027-07-31' })
  })

  it('ignores the flag of another facility\'s group in the history of a child that moved here', () => {
    const krippe = addFacility(db, 'Krippe')
    const foreignHort = addGroup(db, krippe, 'Hort')
    setGroupForSchoolChildren(db, foreignHort, true)
    const id = addChild(db, 1, { birthDate: BORN_ON_CUTOFF, groupId: null })
    db.update(childGroupChanges).set({ groupId: foreignHort }).where(eq(childGroupChanges.childId, id)).run()
    expect(occupancyChildren(db, 1).children.find(child => child.id === id)).toMatchObject({ end: DAY_BEFORE })
    expect(schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)).toEqual([id])
  })
})

describe('automatic leaving of school children', () => {
  let db: Db
  let admin: ChildActor
  let bears: number
  let hort: number
  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    hort = addGroup(db, 1, 'Hort')
  })

  const row = (id: number) => db.select().from(children).where(eq(children.id, id)).get()!
  const leftOn = (id: number) => row(id).leftOn
  /** Every child (all facilities) with a leaving day. */
  const leftIds = () => db.select().from(children).all().filter(child => child.leftOn !== null).map(child => child.id).sort()
  const history = (id: number) => db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, id))
    .orderBy(asc(childGroupChanges.fromDate), asc(childGroupChanges.id)).all()
    .map(entry => [entry.fromDate, entry.groupId, entry.appliedAt !== null])
  const change = (groupId: number, date: string, newContract?: boolean): GroupChangeInput =>
    ({ groupId, date, keep: KEEP_ALL, ...(newContract === undefined ? {} : { newContract }) })
  /** A child of the Bären born on the cutoff: its school start is 1 September 2027. */
  const schoolChild = (overrides: Parameters<typeof addChild>[2] = {}, facilityId = 1) =>
    addChild(db, facilityId, { birthDate: BORN_ON_CUTOFF, groupId: facilityId === 1 ? bears : null, ...overrides })
  /** Switches the automatic leaving on as the Träger does: confirming the children the preview shows that day. */
  const switchOn = (facilityId = 1, today = TODAY) => setAutoLeave(db, facilityId, true, today, schoolLeavers(db, facilityId, today))
  const isOn = (facilityId = 1) => getSchoolSettings(db, facilityId).autoLeave
  /** A child as the Träger confirms it: with the leaving day the preview showed. */
  const confirmed = (id: number, leavingDay = DAY_BEFORE) => ({ id, leftOn: leavingDay })

  describe('the switch', () => {
    it('is off for every facility until it is set, per facility', () => {
      const krippe = addFacility(db, 'Krippe')
      expect(getSchoolSettings(db, 1).autoLeave).toBe(false)
      switchOn()
      expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: true, stateCutoff: BW_CUTOFF })
      expect(getSchoolSettings(db, krippe).autoLeave).toBe(false)
      setAutoLeave(db, 1, false, TODAY)
      expect(getSchoolSettings(db, 1).autoLeave).toBe(false)
    })

    it('answers facility_not_found for an unknown facility', () => {
      expect(errorCode(() => setAutoLeave(db, 999, true, TODAY, []))).toBe('facility_not_found')
      expect(errorCode(() => setAutoLeave(db, 999, false, TODAY))).toBe('facility_not_found')
    })

    describe('switching on', () => {
      it('deregisters exactly the confirmed children at once, like the daily run', () => {
        const krippe = addFacility(db, 'Krippe')
        const mice = addGroup(db, 1, 'Mäuse')
        const here = schoolChild()
        const young = schoolChild({ birthDate: '2022-03-15' })
        const there = schoolChild({}, krippe)
        planGroupChange(db, admin, 1, here, change(mice, '2027-10-01'), TODAY, NOW)
        const preview = schoolLeavers(db, 1, '2027-09-20')
        expect(preview.map(child => child.id)).toEqual([here])

        // The preview's entries can be sent back as they are.
        expect(setAutoLeave(db, 1, true, '2027-09-20', preview)).toBe(1)

        expect(isOn()).toBe(true)
        expect(leftOn(here)).toBe(DAY_BEFORE)
        expect([young, there].map(leftOn)).toEqual([null, null])
        // The planned change after the leaving day goes with it.
        expect(history(here)).toEqual([[null, bears, true]])
        // Nothing is left for the daily run.
        expect(leaveSchoolChildren(db, '2027-09-20')).toBe(0)
        expect(isOn(krippe)).toBe(false)
      })

      it('shows with every child of the preview the day from which its record may be deleted: the leaving day plus the retention period', () => {
        const id = schoolChild()
        const leapDay = schoolChild({ schoolStartDate: '2028-03-01' })
        // Sorted by name, then id.
        expect(schoolLeavers(db, 1, '2028-03-05').map(child => [child.id, child.leftOn, child.purgeOn])).toEqual([
          [id, DAY_BEFORE, '2030-08-31'], [leapDay, '2028-02-29', '2031-02-28'],
        ])
        setChildRetentionYears(db, 5)
        const preview = schoolLeavers(db, 1, '2028-03-05')
        expect(preview.map(child => child.purgeOn)).toEqual(['2032-08-31', '2033-02-28'])

        // What the preview announces is what the archive shows once they are deregistered.
        expect(setAutoLeave(db, 1, true, '2028-03-05', preview.map(({ id, leftOn }) => ({ id, leftOn })))).toBe(2)
        expect(listArchive(db, 1, '2028-03-05').map(child => [child.id, child.purgeOn]).sort()).toEqual(
          preview.map(child => [child.id, child.purgeOn]).sort(),
        )
      })

      it('refuses when the confirmed children are not the ones it would deregister now, and changes nothing', () => {
        const first = schoolChild()
        const second = schoolChild()
        const young = schoolChild({ birthDate: '2022-03-15' })
        const switching = (list?: { id: number; leftOn: string }[]) => errorCode(() => setAutoLeave(db, 1, true, SCHOOL_START, list))

        expect(switching([confirmed(first)])).toBe('auto_leave_preview_changed')
        expect(switching([confirmed(first), confirmed(second), confirmed(young)])).toBe('auto_leave_preview_changed')
        expect(switching([confirmed(first), confirmed(young)])).toBe('auto_leave_preview_changed')
        expect(switching([])).toBe('auto_leave_preview_changed')
        expect(switching()).toBe('auto_leave_preview_changed')
        // The right children with another leaving day than they would get are not what was confirmed either.
        expect(switching([confirmed(first), confirmed(second, '2027-08-30')])).toBe('auto_leave_preview_changed')
        expect(switching([confirmed(first), confirmed(second), confirmed(second, '2027-08-30')])).toBe('auto_leave_preview_changed')

        expect(isOn()).toBe(false)
        expect(leftIds()).toEqual([])
        // The order of the entries and a doubled entry do not matter.
        expect(setAutoLeave(db, 1, true, SCHOOL_START, [confirmed(second), confirmed(first), confirmed(second)])).toBe(2)
        expect(leftIds()).toEqual([first, second])
      })

      it('answers 409 so the Träger looks at the list again', () => {
        schoolChild()
        try {
          setAutoLeave(db, 1, true, SCHOOL_START, [])
          expect.unreachable()
        }
        catch (error) {
          expect(error).toMatchObject({ statusCode: 409, code: 'auto_leave_preview_changed' })
        }
      })

      it('refuses when the list changed between the preview and the confirmation', () => {
        const id = schoolChild()
        const preview = schoolLeavers(db, 1, SCHOOL_START)
        // In between somebody registers a leaving day by hand: nobody is left to deregister.
        leaveChild(db, 1, id, '2027-09-30', SCHOOL_START)
        expect(errorCode(() => setAutoLeave(db, 1, true, SCHOOL_START, preview))).toBe('auto_leave_preview_changed')
        expect(isOn()).toBe(false)
        expect(leftOn(id)).toBe('2027-09-30')
        expect(setAutoLeave(db, 1, true, SCHOOL_START, [])).toBe(0)
        expect(isOn()).toBe(true)
      })

      it('refuses when a child\'s leaving day changed between the preview and the confirmation', () => {
        const id = schoolChild()
        const preview = schoolLeavers(db, 1, SCHOOL_START)
        expect(preview).toEqual([{ id, name: 'Kind Muster', schoolStart: SCHOOL_START, leftOn: DAY_BEFORE, purgeOn: '2030-08-31' }])
        // In between somebody enters an earlier school start: the same child, but it would leave two weeks earlier.
        db.update(children).set({ schoolStartDate: '2027-08-16' }).where(eq(children.id, id)).run()

        expect(errorCode(() => setAutoLeave(db, 1, true, SCHOOL_START, preview))).toBe('auto_leave_preview_changed')
        expect(isOn()).toBe(false)
        expect(leftOn(id)).toBeNull()

        expect(setAutoLeave(db, 1, true, SCHOOL_START, schoolLeavers(db, 1, SCHOOL_START))).toBe(1)
        expect(leftOn(id)).toBe('2027-08-15')
      })

      it('needs no children to switch on when nobody is to be deregistered, and none to switch off', () => {
        const id = schoolChild()
        expect(setAutoLeave(db, 1, true, TODAY)).toBe(0)
        expect(isOn()).toBe(true)
        // Switching off never deregisters, whoever is due by then.
        expect(setAutoLeave(db, 1, false, SCHOOL_START)).toBe(0)
        expect(isOn()).toBe(false)
        expect(leftOn(id)).toBeNull()
      })

      it('checks the list again when it is switched on while it is on', () => {
        const id = schoolChild()
        switchOn()
        expect(errorCode(() => setAutoLeave(db, 1, true, SCHOOL_START, []))).toBe('auto_leave_preview_changed')
        expect(isOn()).toBe(true)
        expect(setAutoLeave(db, 1, true, SCHOOL_START, [confirmed(id)])).toBe(1)
      })
    })

    describe('is switched off when a setting widens whom it takes', () => {
      it('by another cutoff, not by storing the same one', () => {
        const krippe = addFacility(db, 'Krippe')
        switchOn()
        switchOn(krippe)

        expect(setSchoolCutoff(db, 1, { cutoffMonth: 6, cutoffDay: 30, ageYears: 6 }))
          .toEqual({ settings: { cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: true, stateCutoff: BW_CUTOFF }, autoLeaveSwitchedOff: false })
        expect(errorCode(() => setSchoolCutoff(db, 1, { cutoffMonth: 6, cutoffDay: 31, ageYears: 6 }))).toBe('invalid_school_cutoff')
        expect(isOn()).toBe(true)

        expect(setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 30, ageYears: 6 }))
          .toEqual({ settings: { cutoffMonth: 9, cutoffDay: 30, ageYears: 6, autoLeave: false, stateCutoff: BW_CUTOFF }, autoLeaveSwitchedOff: true })
        expect(isOn()).toBe(false)
        // Already off: another cutoff changes nothing about the switch, and nothing is reported.
        expect(setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 29, ageYears: 6 }).autoLeaveSwitchedOff).toBe(false)
        switchOn()
        setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 30, ageYears: 6 })
        expect(isOn(krippe)).toBe(true)
        // Each of the three values counts.
        switchOn()
        setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 29, ageYears: 6 })
        expect(isOn()).toBe(false)
        switchOn()
        setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 29, ageYears: 5 })
        expect(isOn()).toBe(false)
      })

      it('so a child the new cutoff makes a school child is not deregistered behind the Träger\'s back', () => {
        // Born 1 July 2020: school start 2027 with the cutoff 30 June, 2026 (reached) with the cutoff 1 July.
        const id = schoolChild({ birthDate: '2020-07-01' })
        switchOn()
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)

        setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })

        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
        expect(leftOn(id)).toBeNull()
        // The preview names it; only confirming that switches on again.
        expect(schoolLeavers(db, 1, TODAY).map(child => child.id)).toEqual([id])
        expect(errorCode(() => setAutoLeave(db, 1, true, TODAY, []))).toBe('auto_leave_preview_changed')
      })

      it('by taking the flag "for school children" away from a group, in that group\'s facility only', () => {
        const krippe = addFacility(db, 'Krippe')
        const foreignHort = addGroup(db, krippe, 'Hort')
        setGroupForSchoolChildren(db, hort, true)
        setGroupForSchoolChildren(db, foreignHort, true)
        const id = addChild(db, 1, { birthDate: '2020-03-01', groupId: hort })
        switchOn()
        switchOn(krippe)

        // Flagging, and taking away a flag that was not there, cannot widen anything.
        expect(setGroupForSchoolChildren(db, hort, true)).toEqual({ autoLeaveSwitchedOff: false })
        expect(setGroupForSchoolChildren(db, bears, false)).toEqual({ autoLeaveSwitchedOff: false })
        expect(setGroupForSchoolChildren(db, bears, true)).toEqual({ autoLeaveSwitchedOff: false })
        expect(isOn()).toBe(true)

        expect(setGroupForSchoolChildren(db, hort, false)).toEqual({ autoLeaveSwitchedOff: true })

        expect(isOn()).toBe(false)
        expect(isOn(krippe)).toBe(true)
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
        expect(leftOn(id)).toBeNull()
        expect(schoolLeavers(db, 1, TODAY).map(child => child.id)).toEqual([id])
      })

      it('reports the switch only when it was on', () => {
        setGroupForSchoolChildren(db, hort, true)
        // Off already: taking the flag away reports nothing.
        expect(setGroupForSchoolChildren(db, hort, false)).toEqual({ autoLeaveSwitchedOff: false })
        setGroupForSchoolChildren(db, hort, true)
        switchOn()
        expect(setGroupForSchoolChildren(db, hort, false)).toEqual({ autoLeaveSwitchedOff: true })
        // Deleting a flagged group while the switch is off reports nothing either.
        const second = addGroup(db, 1, 'Hort 2')
        setGroupForSchoolChildren(db, second, true)
        expect(deleteGroup(db, 1, second, TODAY)).toEqual({ autoLeaveSwitchedOff: false })
      })

      it('by deleting a group that was for school children, in that group\'s facility only', () => {
        const krippe = addFacility(db, 'Krippe')
        const mice = addGroup(db, 1, 'Mäuse')
        setGroupForSchoolChildren(db, hort, true)
        // In the Hort on its school start (1 September 2026), in the Bären since 1 October 2026: the Hort is empty.
        const id = addChild(db, 1, { birthDate: '2020-03-01', groupId: hort })
        planGroupChange(db, admin, 1, id, change(bears, '2026-10-01'), TODAY, NOW)
        switchOn()
        switchOn(krippe)
        expect(schoolLeavers(db, 1, TODAY)).toEqual([])

        // An ordinary group cannot make anybody stay, so deleting it widens nothing.
        expect(deleteGroup(db, 1, mice, TODAY)).toEqual({ autoLeaveSwitchedOff: false })
        expect(isOn()).toBe(true)

        // With the Hort gone the history no longer says the child was in a group for school children.
        expect(deleteGroup(db, 1, hort, TODAY)).toEqual({ autoLeaveSwitchedOff: true })

        expect(isOn()).toBe(false)
        expect(isOn(krippe)).toBe(true)
        expect(history(id)).toEqual([[null, null, true], ['2026-10-01', bears, true]])
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
        expect(leftOn(id)).toBeNull()
        expect(schoolLeavers(db, 1, TODAY).map(child => child.id)).toEqual([id])
      })

      it('not by a deletion that is refused', () => {
        setGroupForSchoolChildren(db, hort, true)
        addChild(db, 1, { birthDate: '2020-03-01', groupId: hort })
        switchOn()
        expect(errorCode(() => deleteGroup(db, 1, hort, TODAY))).toBe('group_has_children')
        expect(isOn()).toBe(true)
      })

      it('not by another retention period: it no longer decides whom the leaving takes', () => {
        const krippe = addFacility(db, 'Krippe')
        const id = schoolChild()
        switchOn()
        switchOn(krippe)
        const before = schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)

        for (const years of [1, 4, 10]) setChildRetentionYears(db, years)
        expect(errorCode(() => setChildRetentionYears(db, 11))).toBe('invalid_retention')

        expect([isOn(), isOn(krippe)]).toEqual([true, true])
        expect(schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)).toEqual(before)
        expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
        expect(leftOn(id)).toBe(DAY_BEFORE)
        // Nothing to tell the Träger about any more.
        const route = readFileSync(join(process.cwd(), 'server', 'api', 'child-retention.put.ts'), 'utf8')
        expect(route).not.toContain('autoLeaveSwitchedOff')
      })
    })

    it('deregisters nobody while the switch is off, whatever the day', () => {
      const id = schoolChild()
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leaveSchoolChildren(db, '2028-03-01')).toBe(0)
      expect(leftOn(id)).toBeNull()
      // The preview does not depend on the switch: it is what switching on would do.
      expect(schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)).toEqual([id])
    })

    it('leaves the children of a facility with the switch off alone, next to one with it on', () => {
      const krippe = addFacility(db, 'Krippe')
      const here = schoolChild()
      const there = schoolChild({}, krippe)
      switchOn()

      expect(schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)).toEqual([here])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)

      expect(leftOn(here)).toBe(DAY_BEFORE)
      expect(leftOn(there)).toBeNull()
      expect(schoolLeavers(db, krippe, SCHOOL_START).map(child => child.id)).toEqual([there])
      // Each facility on its own: the other one switches on later, and its child leaves with that.
      expect(switchOn(krippe, '2027-09-02')).toBe(1)
      expect(leftOn(there)).toBe(DAY_BEFORE)
      expect(leaveSchoolChildren(db, '2027-09-02')).toBe(0)
    })
  })

  describe('the day', () => {
    beforeEach(() => {
      switchOn()
    })

    it('deregisters on the school start day and not the day before', () => {
      const id = schoolChild({ firstName: 'Lena', lastName: 'Meier' })

      expect(schoolLeavers(db, 1, DAY_BEFORE)).toEqual([])
      expect(leaveSchoolChildren(db, DAY_BEFORE)).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(getChild(db, admin, id, DAY_BEFORE).status).toBe('active')

      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([{ id, name: 'Lena Meier', schoolStart: SCHOOL_START, leftOn: DAY_BEFORE, purgeOn: '2030-08-31' }])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
      expect(getChild(db, admin, id, SCHOOL_START).status).toBe('archived')
      // The retention period runs from the leaving day.
      expect(listArchive(db, 1, SCHOOL_START)).toEqual([{ id, name: 'Lena Meier', leftOn: DAY_BEFORE, purgeOn: '2030-08-31' }])
    })

    it('changes nothing in a second run', () => {
      const id = schoolChild()
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      const after = row(id)
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leaveSchoolChildren(db, '2027-09-02')).toBe(0)
      expect(schoolLeavers(db, 1, '2027-09-02')).toEqual([])
      expect(row(id)).toEqual(after)
    })

    it('uses the day before the school start as the leaving day when the run comes long after it', () => {
      const id = schoolChild()
      expect(schoolLeavers(db, 1, '2028-02-10').map(child => [child.id, child.leftOn])).toEqual([[id, DAY_BEFORE]])
      expect(leaveSchoolChildren(db, '2028-02-10')).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
    })

    it('leaves a child born one day after the cutoff for another year', () => {
      const id = schoolChild({ birthDate: '2021-07-01' })
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leaveSchoolChildren(db, '2028-08-31')).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(leaveSchoolChildren(db, '2028-09-01')).toBe(1)
      expect(leftOn(id)).toBe('2028-08-31')
    })

    it('follows a manual school start: a later one keeps the child, an earlier one takes it along', () => {
      const deferred = schoolChild({ schoolStartDate: '2028-09-01' })
      const early = schoolChild({ birthDate: '2021-07-01', schoolStartDate: SCHOOL_START })

      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(early)).toBe(DAY_BEFORE)
      expect(leftOn(deferred)).toBeNull()
      expect(leaveSchoolChildren(db, '2028-08-31')).toBe(0)
      expect(leaveSchoolChildren(db, '2028-09-01')).toBe(1)
      expect(leftOn(deferred)).toBe('2028-08-31')
    })

    it('uses the day before a manual school start that is not a 1 September', () => {
      const id = schoolChild({ schoolStartDate: '2027-08-16' })
      expect(leaveSchoolChildren(db, '2027-08-15')).toBe(0)
      expect(leaveSchoolChildren(db, '2027-08-16')).toBe(1)
      expect(leftOn(id)).toBe('2027-08-15')
    })

    it('follows the facility\'s cutoff', () => {
      const id = schoolChild({ birthDate: '2021-07-01' })
      setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
      // The new cutoff switched the automatic leaving off; the Träger switches it on again.
      switchOn()
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
    })
  })

  describe('who is left alone', () => {
    beforeEach(() => {
      switchOn()
    })

    it('never touches a leaving day that is already set, later or earlier', () => {
      const leavesLater = schoolChild({ leftOn: '2027-12-31' })
      const leavesEarlier = schoolChild({ leftOn: '2027-07-31' })
      const archived = schoolChild({ leftOn: '2026-12-31' })

      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)

      expect([leavesLater, leavesEarlier, archived].map(leftOn)).toEqual(['2027-12-31', '2027-07-31', '2026-12-31'])
    })

    it('never touches a Vormerkung', () => {
      const id = schoolChild({ admissionStatus: 'waitlist', entryDate: null, plannedEntryDate: '2026-11-01' })
      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(getChild(db, admin, id, SCHOOL_START).status).toBe('planned')
    })

    it('never touches a contract child that has not started, although its school start is reached', () => {
      const future = schoolChild({ entryDate: '2027-10-01' })
      const plannedOnly = schoolChild({ entryDate: null, plannedEntryDate: '2027-01-01' })
      const undated = schoolChild({ entryDate: null, plannedEntryDate: null })

      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)

      expect([future, plannedOnly, undated].map(leftOn)).toEqual([null, null, null])
      expect([future, plannedOnly, undated].map(id => getChild(db, admin, id, SCHOOL_START).status)).toEqual(['planned', 'planned', 'planned'])
    })

    it('never deregisters a child to a day before it started, also once it has started', () => {
      // Starts a month after its school start, and on the school start itself: the leaving day would lie before the start.
      const later = schoolChild({ firstName: 'Max', lastName: 'Zander', entryDate: '2027-10-01' })
      const sameDay = schoolChild({ firstName: 'Ida', lastName: 'Adler', entryDate: SCHOOL_START })
      // Started the day before its school start: one day in the facility, then it leaves.
      const dayBefore = schoolChild({ entryDate: DAY_BEFORE })

      expect(schoolLeavers(db, 1, '2027-10-01').map(child => child.id)).toEqual([dayBefore])
      expect(leaveSchoolChildren(db, '2027-10-01')).toBe(1)
      expect(leaveSchoolChildren(db, '2028-10-01')).toBe(0)

      expect([later, sameDay, dayBefore].map(leftOn)).toEqual([null, null, DAY_BEFORE])
      expect(getChild(db, admin, later, '2027-10-01').status).toBe('active')
      // They are not forgotten: the occupancy names them as inconsistent.
      expect(occupancyChildren(db, 1).inconsistent).toEqual([{ id: sameDay, name: 'Ida Adler' }, { id: later, name: 'Max Zander' }])
    })

    it('does not leave alone a child whose leaving day is past the retention period: it is deregistered and kept', () => {
      // School start 1 September 2023: with three years of retention the record of a leaving day 31 August 2023 may
      // be deleted from 31 August 2026 on, which has passed.
      const expired = schoolChild({ birthDate: '2017-03-01', entryDate: '2022-09-01' })
      // School start 1 September 2024: the record may be deleted from 31 August 2027 on.
      const kept = schoolChild({ birthDate: '2018-03-01', entryDate: '2022-09-01' })

      expect(schoolLeavers(db, 1, TODAY).map(child => [child.id, child.leftOn, child.purgeOn])).toEqual([
        [expired, '2023-08-31', '2026-08-31'], [kept, '2024-08-31', '2027-08-31'],
      ])
      expect(leaveSchoolChildren(db, TODAY)).toBe(2)
      expect(leftOn(expired)).toBe('2023-08-31')
      expect(leftOn(kept)).toBe('2024-08-31')
      // Archived, not deleted: only the Träger deletes a record, by hand.
      expect(getChild(db, admin, expired, TODAY).status).toBe('archived')
    })
  })

  describe('planned group changes', () => {
    beforeEach(() => {
      switchOn()
    })

    it('removes a planned change after the leaving day, so it neither is applied later nor blocks deleting the group', () => {
      const mice = addGroup(db, 1, 'Mäuse')
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(mice, '2027-10-01'), TODAY, NOW)
      expect(history(id)).toEqual([[null, bears, true], ['2027-10-01', mice, false]])

      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)

      expect(history(id)).toEqual([[null, bears, true]])
      unleaveChild(db, 1, id, '2027-09-10', '2028-09-01')
      expect(applyDueGroupChanges(db, '2027-10-01')).toBe(0)
      expect(row(id).groupId).toBe(bears)
      expect(errorCode(() => deleteGroup(db, 1, mice, '2027-10-01'))).toBeNull()
    })

    it('keeps a planned change up to the leaving day', () => {
      const mice = addGroup(db, 1, 'Mäuse')
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(mice, DAY_BEFORE), TODAY, NOW)

      // The run for the school start comes before the one that applies the change.
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)

      expect(history(id)).toEqual([[null, bears, true], [DAY_BEFORE, mice, false]])
      expect(applyDueGroupChanges(db, SCHOOL_START)).toBe(1)
      expect(row(id).groupId).toBe(mice)
    })

    it('leaves the planned changes of other children alone', () => {
      const mice = addGroup(db, 1, 'Mäuse')
      const leaver = schoolChild()
      const stays = schoolChild({ birthDate: '2022-03-15' })
      planGroupChange(db, admin, 1, stays, change(mice, '2027-10-01'), TODAY, NOW)

      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)

      expect(leftIds()).toEqual([leaver])
      expect(history(stays)).toEqual([[null, bears, true], ['2027-10-01', mice, false]])
    })
  })

  describe('after-school care', () => {
    it('lists the older children of a group that is not flagged yet, and deregisters exactly the listed ones', () => {
      // School start 1 September 2026, reached on 13 October 2026.
      const older = addChild(db, 1, { firstName: 'Ole', lastName: 'Hansen', birthDate: '2020-03-01', groupId: hort })
      const oldest = addChild(db, 1, { firstName: 'Mia', lastName: 'Berg', birthDate: '2019-05-05', entryDate: '2024-09-01', groupId: hort })
      const young = addChild(db, 1, { birthDate: '2022-03-15', groupId: bears })

      const preview = schoolLeavers(db, 1, TODAY)
      expect(preview).toEqual([
        { id: oldest, name: 'Mia Berg', schoolStart: '2025-09-01', leftOn: '2025-08-31', purgeOn: '2028-08-31' },
        { id: older, name: 'Ole Hansen', schoolStart: '2026-09-01', leftOn: '2026-08-31', purgeOn: '2029-08-31' },
      ])

      // Switching on with the list confirmed deregisters them at once; the daily run finds nobody else.
      expect(switchOn()).toBe(2)
      expect(leftIds()).toEqual(preview.map(child => child.id).sort())
      expect(leftOn(young)).toBeNull()
      for (const child of preview) expect(leftOn(child.id)).toBe(child.leftOn)
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
    })

    it('deregisters exactly the listed ones in the daily run as well, when they come up while the switch is on', () => {
      switchOn()
      const older = addChild(db, 1, { birthDate: '2020-03-01', groupId: hort })
      const young = addChild(db, 1, { birthDate: '2022-03-15', groupId: bears })
      const preview = schoolLeavers(db, 1, TODAY)
      expect(preview.map(child => child.id)).toEqual([older])

      expect(leaveSchoolChildren(db, TODAY)).toBe(1)

      expect(leftIds()).toEqual([older])
      expect(leftOn(young)).toBeNull()
    })

    it('lists and deregisters nobody of a group once it is flagged', () => {
      const older = addChild(db, 1, { birthDate: '2020-03-01', groupId: hort })
      setGroupForSchoolChildren(db, hort, true)
      switchOn()

      expect(schoolLeavers(db, 1, TODAY)).toEqual([])
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      expect(leaveSchoolChildren(db, '2030-01-01')).toBe(0)
      expect(leftOn(older)).toBeNull()
    })

    it('does not deregister a child with a planned change into a group for school children on its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      switchOn()
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, SCHOOL_START, true), TODAY, NOW)

      // Whether the change is applied before or after the run makes no difference.
      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(applyDueGroupChanges(db, SCHOOL_START)).toBe(1)
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leaveSchoolChildren(db, '2029-09-01')).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(row(id).groupId).toBe(hort)
      expect(occupancyChildren(db, 1).children.find(child => child.id === id)).toMatchObject({ end: null })
    })

    it('does not deregister a child that changed into such a group before its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      switchOn()
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, '2027-08-01', true), TODAY, NOW)
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leftOn(id)).toBeNull()
    })

    it('does not deregister a child whose change into such a group only comes after its school start, and keeps the change', () => {
      setGroupForSchoolChildren(db, hort, true)
      switchOn()
      const id = schoolChild()
      // The after-school contract starts on 13 September, after the first days of school.
      planGroupChange(db, admin, 1, id, change(hort, '2027-09-13', true), TODAY, NOW)

      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leaveSchoolChildren(db, '2027-09-12')).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(history(id)).toEqual([[null, bears, true], ['2027-09-13', hort, false]])
      expect(occupancyChildren(db, 1).children.find(child => child.id === id)).toMatchObject({ end: null })

      // The change is applied on its day, with the care contract to confirm; the child stays for good.
      expect(applyDueGroupChanges(db, '2027-09-13')).toBe(1)
      expect(row(id)).toMatchObject({ groupId: hort, leftOn: null, contractReviewSince: '2027-09-13' })
      expect(leaveSchoolChildren(db, '2027-09-13')).toBe(0)
      expect(leaveSchoolChildren(db, '2029-09-01')).toBe(0)
      expect(leftOn(id)).toBeNull()
    })

    it('does not deregister a child that is in such a group through an applied change dated after its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      // School start 1 September 2026; in the Hort since 1 October 2026 (applied at once on 13 October).
      const id = schoolChild({ birthDate: '2020-03-01' })
      planGroupChange(db, admin, 1, id, change(hort, '2026-10-01', true), TODAY, NOW)
      expect(history(id)).toEqual([[null, bears, true], ['2026-10-01', hort, true]])

      expect(schoolLeavers(db, 1, TODAY)).toEqual([])
      expect(switchOn()).toBe(0)
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      expect(leaveSchoolChildren(db, '2028-01-01')).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(occupancyChildren(db, 1)).toMatchObject({ inconsistent: [] })
      expect(occupancyChildren(db, 1).children.find(child => child.id === id)).toMatchObject({ end: null })
      // Taking a leaving back needs no new school start either.
      leaveChild(db, 1, id, '2026-12-31', '2027-01-10')
      unleaveChild(db, 1, id, '2027-01-10')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
    })

    it('never deletes a planned change that carries a further care contract, whatever became of the group\'s flag', () => {
      setGroupForSchoolChildren(db, hort, true)
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, '2027-09-13', true), TODAY, NOW)
      // The Träger takes the flag away (which switches off) and switches on again: by the groups the child would leave.
      setGroupForSchoolChildren(db, hort, false)
      switchOn()

      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)

      expect(leftOn(id)).toBeNull()
      expect(history(id)).toEqual([[null, bears, true], ['2027-09-13', hort, false]])
      expect(getChild(db, admin, id, SCHOOL_START).pendingGroupChange).toMatchObject({ groupId: hort, newContract: true })
    })

    it('never deregisters that child once the change is applied either: somebody concluded a contract for the time after', () => {
      setGroupForSchoolChildren(db, hort, true)
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, '2027-09-13', true), TODAY, NOW)
      setGroupForSchoolChildren(db, hort, false)
      switchOn()

      // The daily run of the change day: it applies the change and then looks for school children to deregister.
      expect(applyDueGroupChanges(db, '2027-09-13')).toBe(1)
      expect(schoolLeavers(db, 1, '2027-09-13')).toEqual([])
      expect(leaveSchoolChildren(db, '2027-09-13')).toBe(0)
      expect(leaveSchoolChildren(db, '2028-03-01')).toBe(0)

      // In the group, which is an ordinary one by now: no contract marker, and no leaving day.
      expect(row(id)).toMatchObject({ groupId: hort, leftOn: null, contractReviewSince: null })
      expect(history(id)).toEqual([[null, bears, true], ['2027-09-13', hort, true]])
    })

    it('takes a child whose contract change lies before its school start once the group is an ordinary one', () => {
      setGroupForSchoolChildren(db, hort, true)
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, '2027-08-01', true), TODAY, NOW)
      setGroupForSchoolChildren(db, hort, false)
      switchOn()
      expect(applyDueGroupChanges(db, '2027-08-01')).toBe(1)

      // That contract started before the leaving day: the leaving does not cut anything off that was agreed for later.
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
    })

    it('deregisters a child that moved back out of such a group before its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      switchOn()
      const id = schoolChild({ groupId: hort })
      planGroupChange(db, admin, 1, id, change(bears, '2027-06-01'), TODAY, NOW)
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
    })
  })

  describe('single edits that would deregister a child at the next run', () => {
    const NEW_CHILD: ChildMasterInput = {
      lastName: 'Meier', firstName: 'Lena', birthDate: '2020-03-01', address: '', groupId: null, careTypeId: null,
      entryDate: '2026-01-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
      schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null,
    }
    /** School start 1 September 2026: reached on 13 October 2026. */
    const reached = (overrides: Parameters<typeof addChild>[2] = {}) => schoolChild({ birthDate: '2020-03-01', ...overrides })
    const saveMaster = (id: number, changes: Partial<ChildMasterInput>, today = TODAY) =>
      updateChildMaster(db, admin, 1, id, { ...getChild(db, admin, id, today).master, ...changes }, today, new Date(`${today}T08:30:00.000Z`))
    const refusal = (write: () => unknown) => {
      try {
        write()
        return null
      }
      catch (error) {
        return { statusCode: (error as { statusCode?: number }).statusCode, code: (error as { code?: string }).code }
      }
    }
    const REFUSED = { statusCode: 409, code: 'would_deregister' }
    const pendingId = (id: number) => getChild(db, admin, id, TODAY).pendingGroupChange!.id
    /** The child stays because of a planned change into the Hort after its school start, with a further care contract. */
    const withPlannedHort = () => {
      setGroupForSchoolChildren(db, hort, true)
      const id = reached()
      planGroupChange(db, admin, 1, id, change(hort, '2026-11-01', true), TODAY, NOW)
      return id
    }

    describe('while the automatic leaving is on', () => {
      it('refuses to clear the manual school start of a deferred child, and leaves the record as it is', () => {
        const id = reached({ schoolStartDate: '2027-09-01' })
        switchOn()
        const before = row(id)

        expect(refusal(() => saveMaster(id, { schoolStartDate: null, note: 'zurückgestellt' }))).toEqual(REFUSED)

        expect(row(id)).toEqual(before)
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
        expect(leftOn(id)).toBeNull()
        // A later school start, or any other change, is saved as before.
        saveMaster(id, { schoolStartDate: '2028-09-01', note: 'zurückgestellt' })
        expect(row(id)).toMatchObject({ schoolStartDate: '2028-09-01', note: 'zurückgestellt' })
      })

      it('refuses an earlier manual school start and a birth date that make the school start reached', () => {
        const id = schoolChild()
        switchOn()
        expect(refusal(() => saveMaster(id, { schoolStartDate: '2026-09-01' }))).toEqual(REFUSED)
        expect(refusal(() => saveMaster(id, { birthDate: '2020-06-30' }))).toEqual(REFUSED)
        expect(row(id)).toMatchObject({ schoolStartDate: null, birthDate: BORN_ON_CUTOFF })
      })

      it('refuses a new record the next run would take at once, and creates nothing', () => {
        switchOn()
        const count = () => db.select().from(children).all().length
        const before = count()

        expect(refusal(() => createChild(db, admin, 1, NEW_CHILD, NOW))).toEqual(REFUSED)

        expect(count()).toBe(before)
        expect(db.select().from(childGroupChanges).all()).toEqual([])
        // With a later school start, as a Vormerkung or before it starts the record is created.
        expect(row(createChild(db, admin, 1, { ...NEW_CHILD, schoolStartDate: '2027-09-01' }, NOW)).leftOn).toBeNull()
        createChild(db, admin, 1, { ...NEW_CHILD, admissionStatus: 'waitlist', entryDate: null }, NOW)
        createChild(db, admin, 1, { ...NEW_CHILD, entryDate: '2026-11-01' }, NOW)
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      })

      it('refuses to turn a Vormerkung into a contract child that would be taken at once', () => {
        const id = reached({ admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-01-10' })
        switchOn()
        expect(refusal(() => saveMaster(id, { admissionStatus: 'contract', entryDate: '2026-02-01' }))).toEqual(REFUSED)
        expect(row(id)).toMatchObject({ admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-01-10' })
      })

      it('refuses to delete the planned after-school change after the school start, and keeps it', () => {
        const id = withPlannedHort()
        switchOn()

        expect(refusal(() => deleteGroupChange(db, 1, pendingId(id), TODAY, NOW))).toEqual(REFUSED)

        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', hort, false]])
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
        expect(leftOn(id)).toBeNull()
      })

      it('refuses to retarget that change into an ordinary group, not to move it to another day', () => {
        const id = withPlannedHort()
        const mice = addGroup(db, 1, 'Mäuse')
        switchOn()

        expect(refusal(() => updateGroupChange(db, admin, 1, pendingId(id), change(mice, '2026-11-01'), TODAY, NOW))).toEqual(REFUSED)
        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', hort, false]])
        expect(getChild(db, admin, id, TODAY).pendingGroupChange).toMatchObject({ groupId: hort, newContract: true })

        updateGroupChange(db, admin, 1, pendingId(id), change(hort, '2026-12-01', true), TODAY, NOW)
        expect(history(id)).toEqual([[null, bears, true], ['2026-12-01', hort, false]])
      })

      it('refuses a backdated change that takes a child out of its group for school children before the school start', () => {
        setGroupForSchoolChildren(db, hort, true)
        const id = reached({ groupId: hort })
        switchOn()

        expect(refusal(() => planGroupChange(db, admin, 1, id, change(bears, '2026-08-15'), TODAY, NOW))).toEqual(REFUSED)

        expect(row(id).groupId).toBe(hort)
        expect(history(id)).toEqual([[null, hort, true]])
        // After the school start the same change leaves the child where the school rules see it.
        planGroupChange(db, admin, 1, id, change(bears, '2026-10-01'), TODAY, NOW)
        expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      })

      it('refuses a direct group change out of the group for school children on the school start day', () => {
        setGroupForSchoolChildren(db, hort, true)
        const id = schoolChild({ groupId: hort })
        switchOn()
        expect(refusal(() => saveMaster(id, { groupId: bears }, SCHOOL_START))).toEqual(REFUSED)
        expect(row(id).groupId).toBe(hort)
        expect(history(id)).toEqual([[null, hort, true]])
      })

      it('lets a child be edited that the next run takes anyway: the edit is not what deregisters it', () => {
        const id = schoolChild()
        switchOn()
        // The school start day has come, the daily run has not.
        saveMaster(id, { note: 'Abschiedsfest am Freitag' }, SCHOOL_START)
        expect(row(id).note).toBe('Abschiedsfest am Freitag')
        expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      })

      it('lets a child be edited that the selection passes over on purpose', () => {
        // Started after its school start: the automatic leaving never takes it.
        const id = reached({ entryDate: '2026-09-15' })
        switchOn()
        saveMaster(id, { note: 'Hortkind ohne Hortgruppe' })
        expect(row(id).note).toBe('Hortkind ohne Hortgruppe')
        // Moving its entry before the school start would make the next run take it.
        expect(refusal(() => saveMaster(id, { entryDate: '2026-08-01' }))).toEqual(REFUSED)
        expect(row(id).entryDate).toBe('2026-09-15')
      })

      it('judges by the facility of the child: another facility\'s switch plays no part', () => {
        const krippe = addFacility(db, 'Krippe')
        switchOn(krippe)
        const id = reached({ schoolStartDate: '2027-09-01' })
        saveMaster(id, { schoolStartDate: null })
        expect(row(id).schoolStartDate).toBeNull()
      })
    })

    describe('while it is off', () => {
      it('saves all of these as before', () => {
        const deferred = reached({ schoolStartDate: '2027-09-01' })
        saveMaster(deferred, { schoolStartDate: null })
        expect(row(deferred).schoolStartDate).toBeNull()

        const created = createChild(db, admin, 1, NEW_CHILD, NOW)
        expect(row(created)).toMatchObject({ entryDate: '2026-01-01', leftOn: null })

        const waitlisted = reached({ admissionStatus: 'waitlist', entryDate: null })
        saveMaster(waitlisted, { admissionStatus: 'contract', entryDate: '2026-02-01' })
        expect(row(waitlisted).admissionStatus).toBe('contract')

        const planned = withPlannedHort()
        const mice = addGroup(db, 1, 'Mäuse')
        updateGroupChange(db, admin, 1, pendingId(planned), change(mice, '2026-11-01'), TODAY, NOW)
        deleteGroupChange(db, 1, pendingId(planned), TODAY, NOW)
        expect(history(planned)).toEqual([[null, bears, true]])

        const inHort = reached({ groupId: hort })
        planGroupChange(db, admin, 1, inHort, change(bears, '2026-08-15'), TODAY, NOW)
        expect(row(inHort).groupId).toBe(bears)
      })
    })
  })

  describe('taking the leaving back', () => {
    beforeEach(() => {
      switchOn()
    })

    it('needs a new school start after today for a child whose school start is reached', () => {
      const id = schoolChild()
      leaveSchoolChildren(db, SCHOOL_START)

      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10'))).toBe('school_start_required')
      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10', '2027-09-10'))).toBe('school_start_required')
      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10', '2027-09-01'))).toBe('school_start_required')
      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10', '2028-02-30'))).toBe('invalid_date')
      expect(leftOn(id)).toBe(DAY_BEFORE)
      expect(row(id).schoolStartDate).toBeNull()
    })

    it('makes the child active again with the new school start, and the next runs leave it alone until then', () => {
      const id = schoolChild()
      leaveSchoolChildren(db, SCHOOL_START)

      unleaveChild(db, 1, id, '2027-09-10', '2028-09-01')

      const record = getChild(db, admin, id, '2027-09-10')
      expect(record.status).toBe('active')
      expect(record.leftOn).toBeNull()
      expect(record.master.schoolStartDate).toBe('2028-09-01')
      expect(schoolLeavers(db, 1, '2027-09-10')).toEqual([])
      expect(leaveSchoolChildren(db, '2027-09-10')).toBe(0)
      expect(leaveSchoolChildren(db, '2028-08-31')).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(leaveSchoolChildren(db, '2028-09-01')).toBe(1)
      expect(leftOn(id)).toBe('2028-08-31')
    })

    it('asks for the new school start however the child was deregistered', () => {
      const id = schoolChild()
      leaveChild(db, 1, id, '2027-08-20', '2027-08-20')
      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10'))).toBe('school_start_required')
      unleaveChild(db, 1, id, '2027-09-10', '2027-09-11')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: '2027-09-11' })
    })

    it('needs no new school start while the automatic leaving is off: nothing deregisters the child again', () => {
      const id = schoolChild()
      leaveSchoolChildren(db, SCHOOL_START)
      expect(leftOn(id)).toBe(DAY_BEFORE)
      setAutoLeave(db, 1, false, '2027-09-10')

      unleaveChild(db, 1, id, '2027-09-10')

      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
      expect(getChild(db, admin, id, '2027-09-10').status).toBe('active')
      expect(leaveSchoolChildren(db, '2027-09-10')).toBe(0)
      expect(leftOn(id)).toBeNull()
      // A school start that is sent all the same is not needed and left unused.
      leaveChild(db, 1, id, '2027-09-05', '2027-09-10')
      unleaveChild(db, 1, id, '2027-09-10', '2028-09-01')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
      // The Träger sees the child in the preview before switching on again.
      expect(schoolLeavers(db, 1, '2027-09-10').map(child => child.id)).toEqual([id])
    })

    it('judges by the switch of the child\'s facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const there = schoolChild({ leftOn: DAY_BEFORE }, krippe)
      unleaveChild(db, krippe, there, '2027-09-10')
      expect(row(there)).toMatchObject({ leftOn: null, schoolStartDate: null })
    })

    it('needs none for a child the automatic leaving passes over on purpose', () => {
      // Started after its school start: the next run would not take it.
      const id = schoolChild({ entryDate: '2027-09-06', leftOn: '2027-09-08' })
      unleaveChild(db, 1, id, '2027-09-10')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
      expect(leaveSchoolChildren(db, '2027-09-10')).toBe(0)
    })

    it('stores nothing when the new school start is refused', () => {
      const id = schoolChild()
      leaveSchoolChildren(db, SCHOOL_START)
      const before = row(id)
      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10', '2027-09-10'))).toBe('school_start_required')
      expect(row(id)).toEqual(before)
    })

    it('needs no school start for a child in a group for school children on its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      const id = schoolChild({ groupId: hort })
      leaveChild(db, 1, id, '2027-12-31', '2027-12-31')

      unleaveChild(db, 1, id, '2028-01-10')

      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
      expect(leaveSchoolChildren(db, '2028-01-10')).toBe(0)
    })

    it('needs none before the school start and then leaves the school start as it is', () => {
      const id = schoolChild({ leftOn: '2027-03-31' })
      unleaveChild(db, 1, id, '2027-04-10', '2029-09-01')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
      const manual = schoolChild({ schoolStartDate: '2028-09-01', leftOn: '2027-10-31' })
      unleaveChild(db, 1, manual, '2027-11-10')
      expect(row(manual)).toMatchObject({ leftOn: null, schoolStartDate: '2028-09-01' })
    })

    it('leaves a child alone that has not been deregistered', () => {
      const id = schoolChild()
      unleaveChild(db, 1, id, '2027-09-10')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: null })
    })
  })

  describe('moving a child to another facility', () => {
    let krippe: number
    beforeEach(() => {
      krippe = addFacility(db, 'Krippe')
    })
    const move = (id: number, today = TODAY) => moveChildToFacility(db, id, krippe, new Date(`${today}T08:30:00.000Z`))
    /** School start 1 September 2026: reached on 13 October 2026. */
    const reached = (overrides: Parameters<typeof addChild>[2] = {}) => schoolChild({ birthDate: '2020-03-01', ...overrides })

    it('refuses a child whose school start is reached when the target deregisters automatically, and changes nothing', () => {
      const id = reached()
      switchOn(krippe)

      try {
        move(id)
        expect.unreachable()
      }
      catch (error) {
        expect(error).toMatchObject({ statusCode: 409, code: 'school_start_reached' })
      }

      expect(row(id)).toMatchObject({ facilityId: 1, groupId: bears, leftOn: null })
      expect(history(id)).toEqual([[null, bears, true]])
      // Without the refusal the next run there would have taken it.
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
    })

    it('moves it when the target does not deregister automatically, whatever the facility it comes from does', () => {
      const id = reached()
      switchOn(1)
      expect(leftOn(id)).toBe('2026-08-31')
      const other = reached()
      // Switching on took the first child; the second one came afterwards and moves before the next run.
      move(other)
      expect(row(other)).toMatchObject({ facilityId: krippe, groupId: null, leftOn: null })
    })

    it('moves a child whose school start is still to come, until the day before it', () => {
      const id = schoolChild()
      const late = schoolChild()
      switchOn(krippe)

      move(id, DAY_BEFORE)
      expect(row(id).facilityId).toBe(krippe)
      expect(errorCode(() => move(late, SCHOOL_START))).toBe('school_start_reached')
      expect(row(late).facilityId).toBe(1)
    })

    it('judges by the manual school start and by the cutoff of the target facility', () => {
      // Born 1 July 2020: school start 2027 with the cutoff 30 June, 2026 (reached) with the cutoff 1 July.
      const deferred = reached({ schoolStartDate: '2027-09-01' })
      const byCutoff = schoolChild({ birthDate: '2020-07-01' })
      setSchoolCutoff(db, krippe, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
      switchOn(krippe)

      move(deferred)
      expect(row(deferred).facilityId).toBe(krippe)
      expect(errorCode(() => move(byCutoff))).toBe('school_start_reached')

      // The other way round: reached by the cutoff of the facility it leaves, not by the target's.
      setSchoolCutoff(db, krippe, { cutoffMonth: 6, cutoffDay: 30, ageYears: 6 })
      setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
      switchOn(krippe)
      move(byCutoff)
      expect(row(byCutoff)).toMatchObject({ facilityId: krippe, leftOn: null })
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
    })

    it('moves a Vormerkung and a child with a leaving day: the automatic leaving never takes them', () => {
      const waitlisted = reached({ admissionStatus: 'waitlist', entryDate: null })
      const leaving = reached({ leftOn: '2026-12-31' })
      const archived = reached({ leftOn: '2026-07-31' })
      switchOn(krippe)

      for (const id of [waitlisted, leaving, archived]) move(id)

      expect([waitlisted, leaving, archived].map(id => row(id).facilityId)).toEqual([krippe, krippe, krippe])
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      expect([waitlisted, leaving, archived].map(leftOn)).toEqual([null, '2026-12-31', '2026-07-31'])
    })

    it('moves a child the automatic leaving there would not take: not started yet, or passed over on purpose', () => {
      const notStarted = reached({ entryDate: '2026-11-01' })
      const plannedOnly = reached({ entryDate: null, plannedEntryDate: '2026-01-01' })
      // Started after its school start: the leaving day would lie before its entry.
      const startedLate = reached({ entryDate: '2026-09-15' })
      switchOn(krippe)

      for (const id of [notStarted, plannedOnly, startedLate]) move(id)

      expect([notStarted, plannedOnly, startedLate].map(id => row(id).facilityId)).toEqual([krippe, krippe, krippe])
      expect(schoolLeavers(db, krippe, TODAY)).toEqual([])
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      expect([notStarted, plannedOnly, startedLate].map(leftOn)).toEqual([null, null, null])
    })

    it('refuses exactly the children the next run there would deregister, and rolls the whole move back', () => {
      const taken = reached()
      const mice = addGroup(db, 1, 'Mäuse')
      planGroupChange(db, admin, 1, taken, change(mice, '2027-01-15'), TODAY, NOW)
      switchOn(krippe)

      expect(errorCode(() => move(taken))).toBe('school_start_reached')

      // Nothing of the move is left: facility, group, history and the planned change are as before.
      expect(row(taken)).toMatchObject({ facilityId: 1, groupId: bears })
      expect(history(taken)).toEqual([[null, bears, true], ['2027-01-15', mice, false]])
      expect(schoolLeavers(db, krippe, TODAY)).toEqual([])
    })

    it('still does nothing for a child that is already there', () => {
      const id = reached()
      switchOn(1, '2026-08-01')
      expect(errorCode(() => moveChildToFacility(db, id, 1, NOW))).toBeNull()
      expect(row(id)).toMatchObject({ facilityId: 1, groupId: bears })
    })
  })

  // The run as a whole (its order, its log, a part that fails) is tested in dailyRun.test.ts.
  describe('the daily run', () => {
    it('deregisters the other facilities\' children when one facility fails, and names nobody in the log', () => {
      const krippe = addFacility(db, 'Krippe')
      const hortKita = addFacility(db, 'Hort-Kita')
      const failing = schoolChild({ firstName: 'Lena', lastName: 'Meier' })
      const alsoFailing = schoolChild({ firstName: 'Ole', lastName: 'Hansen' })
      const second = schoolChild({ firstName: 'Ida', lastName: 'Adler' }, krippe)
      const third = schoolChild({ firstName: 'Ben', lastName: 'Kurz' }, hortKita)
      for (const facilityId of [1, krippe, hortKita]) switchOn(facilityId)
      // Facility 1 fails at its second child (by name: Hansen, then Meier), so the first one must be rolled back as well.
      db.run(sql.raw(`CREATE TRIGGER fail_one_facility BEFORE UPDATE OF left_on ON children
        WHEN NEW.id = ${failing} BEGIN SELECT RAISE(ABORT, 'disk trouble'); END`))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(2)

        expect([failing, alsoFailing].map(leftOn)).toEqual([null, null])
        expect([second, third].map(leftOn)).toEqual([DAY_BEFORE, DAY_BEFORE])
        expect(logged).toHaveBeenCalledTimes(1)
        const text = logged.mock.calls.flat().map(part => (part instanceof Error ? `${part.message} ${part.stack}` : String(part))).join(' ')
        expect(text).toContain('facility 1')
        for (const name of ['Lena', 'Meier', 'Ole', 'Hansen']) expect(text).not.toContain(name)
      }
      finally {
        logged.mockRestore()
      }
      // Once the trouble is over, the next run catches up.
      db.run(sql.raw('DROP TRIGGER fail_one_facility'))
      expect(leaveSchoolChildren(db, '2027-09-02')).toBe(2)
      expect([failing, alsoFailing].map(leftOn)).toEqual([DAY_BEFORE, DAY_BEFORE])
    })
  })
})
