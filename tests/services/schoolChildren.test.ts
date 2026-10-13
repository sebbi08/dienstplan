import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges, children } from '../../server/db/schema'
import { setChildRetentionYears } from '../../server/services/appSettings'
import { applyDueGroupChanges, planGroupChange } from '../../server/services/childGroupChanges'
import { getChild, leaveChild, listArchive, purgeExpiredChildren, unleaveChild } from '../../server/services/children'
import { deleteGroup, listGroups, setGroupForSchoolChildren } from '../../server/services/groups'
import {
  getSchoolSettings, leaveSchoolChildren, occupancyChildren, schoolLeavers, setAutoLeave, setSchoolCutoff,
} from '../../server/services/schoolChildren'
import type { FacilityUser } from '../../server/utils/auth'
import type { GroupChangeInput } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')
const KEEP_ALL = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }
/** Born on the default cutoff (30 June, six years): the school start is 1 September 2027. */
const BORN_ON_CUTOFF = '2021-06-30'
const SCHOOL_START = '2027-09-01'
const DAY_BEFORE = '2027-08-31'

describe('school settings of a facility', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('starts with 30 June and six years', () => {
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: false })
  })

  it('stores the cutoff per facility', () => {
    const krippe = addFacility(db, 'Krippe')
    setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 30, ageYears: 5 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 9, cutoffDay: 30, ageYears: 5, autoLeave: false })
    expect(getSchoolSettings(db, krippe)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: false })
  })

  it('accepts 29 February and the age limits 4 and 8', () => {
    setSchoolCutoff(db, 1, { cutoffMonth: 2, cutoffDay: 29, ageYears: 4 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 2, cutoffDay: 29, ageYears: 4, autoLeave: false })
    setSchoolCutoff(db, 1, { cutoffMonth: 12, cutoffDay: 31, ageYears: 8 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 12, cutoffDay: 31, ageYears: 8, autoLeave: false })
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
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: false })
  })

  it('shows the computed school start in the record, for managers and Mitarbeiter, following the cutoff', () => {
    const admin = addUser(db, 'leitung', 'admin') as FacilityUser
    const staff = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')) as FacilityUser
    const id = addChild(db, 1, { birthDate: '2021-07-01' })
    expect(getChild(db, admin, id, TODAY).computedSchoolStart).toBe('2028-09-01')
    setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
    expect(getChild(db, admin, id, TODAY).computedSchoolStart).toBe('2027-09-01')
    expect(getChild(db, staff, id, TODAY).computedSchoolStart).toBe('2027-09-01')
  })

  it('keeps the manual school start separate from the computed one', () => {
    const admin = addUser(db, 'leitung', 'admin') as FacilityUser
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
  let admin: FacilityUser
  let bears: number
  let hort: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin') as FacilityUser
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

  describe('the switch', () => {
    it('is off for every facility until it is set, per facility', () => {
      const krippe = addFacility(db, 'Krippe')
      expect(getSchoolSettings(db, 1).autoLeave).toBe(false)
      setAutoLeave(db, 1, true)
      expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: true })
      expect(getSchoolSettings(db, krippe).autoLeave).toBe(false)
      setAutoLeave(db, 1, false)
      expect(getSchoolSettings(db, 1).autoLeave).toBe(false)
    })

    it('keeps the switch when the cutoff is stored and answers facility_not_found for an unknown facility', () => {
      setAutoLeave(db, 1, true)
      setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 30, ageYears: 5 })
      expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 9, cutoffDay: 30, ageYears: 5, autoLeave: true })
      expect(errorCode(() => setAutoLeave(db, 999, true))).toBe('facility_not_found')
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
      setAutoLeave(db, 1, true)

      expect(schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)).toEqual([here])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)

      expect(leftOn(here)).toBe(DAY_BEFORE)
      expect(leftOn(there)).toBeNull()
      expect(schoolLeavers(db, krippe, SCHOOL_START).map(child => child.id)).toEqual([there])
      // Each facility on its own: the other one switches on later.
      setAutoLeave(db, krippe, true)
      expect(leaveSchoolChildren(db, '2027-09-02')).toBe(1)
      expect(leftOn(there)).toBe(DAY_BEFORE)
    })
  })

  describe('the day', () => {
    beforeEach(() => {
      setAutoLeave(db, 1, true)
    })

    it('deregisters on the school start day and not the day before', () => {
      const id = schoolChild({ firstName: 'Lena', lastName: 'Meier' })

      expect(schoolLeavers(db, 1, DAY_BEFORE)).toEqual([])
      expect(leaveSchoolChildren(db, DAY_BEFORE)).toBe(0)
      expect(leftOn(id)).toBeNull()
      expect(getChild(db, admin, id, DAY_BEFORE).status).toBe('active')

      expect(schoolLeavers(db, 1, SCHOOL_START)).toEqual([{ id, name: 'Lena Meier', schoolStart: SCHOOL_START, leftOn: DAY_BEFORE }])
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
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
    })
  })

  describe('who is left alone', () => {
    beforeEach(() => {
      setAutoLeave(db, 1, true)
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

    it('never deregisters a child whose record would be deleted at once', () => {
      // School start 1 September 2023: with three years of retention a leaving day 31 August 2023 is already expired.
      const expired = schoolChild({ birthDate: '2017-03-01', entryDate: '2022-09-01' })
      // School start 1 September 2024: the record stays until 31 August 2027.
      const kept = schoolChild({ birthDate: '2018-03-01', entryDate: '2022-09-01' })

      expect(schoolLeavers(db, 1, TODAY).map(child => [child.id, child.leftOn])).toEqual([[kept, '2024-08-31']])
      expect(leaveSchoolChildren(db, TODAY)).toBe(1)
      expect(leftOn(expired)).toBeNull()
      expect(leftOn(kept)).toBe('2024-08-31')
      expect(purgeExpiredChildren(db, TODAY)).toBe(0)
      expect(row(expired)).toBeDefined()

      // The retention the Träger set decides, as for the deletion itself.
      setChildRetentionYears(db, 4)
      expect(schoolLeavers(db, 1, TODAY).map(child => [child.id, child.leftOn])).toEqual([[expired, '2023-08-31']])
    })
  })

  describe('planned group changes', () => {
    beforeEach(() => {
      setAutoLeave(db, 1, true)
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
        { id: oldest, name: 'Mia Berg', schoolStart: '2025-09-01', leftOn: '2025-08-31' },
        { id: older, name: 'Ole Hansen', schoolStart: '2026-09-01', leftOn: '2026-08-31' },
      ])

      setAutoLeave(db, 1, true)
      expect(leaveSchoolChildren(db, TODAY)).toBe(2)
      expect(leftIds()).toEqual(preview.map(child => child.id).sort())
      expect(leftOn(young)).toBeNull()
      for (const child of preview) expect(leftOn(child.id)).toBe(child.leftOn)
    })

    it('lists and deregisters nobody of a group once it is flagged', () => {
      const older = addChild(db, 1, { birthDate: '2020-03-01', groupId: hort })
      setGroupForSchoolChildren(db, hort, true)
      setAutoLeave(db, 1, true)

      expect(schoolLeavers(db, 1, TODAY)).toEqual([])
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      expect(leaveSchoolChildren(db, '2030-01-01')).toBe(0)
      expect(leftOn(older)).toBeNull()
    })

    it('does not deregister a child with a planned change into a group for school children on its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      setAutoLeave(db, 1, true)
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
      setAutoLeave(db, 1, true)
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, '2027-08-01', true), TODAY, NOW)
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(0)
      expect(leftOn(id)).toBeNull()
    })

    it('deregisters a child whose change into such a group only comes after its school start, and says so beforehand', () => {
      setGroupForSchoolChildren(db, hort, true)
      setAutoLeave(db, 1, true)
      const id = schoolChild()
      planGroupChange(db, admin, 1, id, change(hort, '2027-09-15', true), TODAY, NOW)

      expect(schoolLeavers(db, 1, SCHOOL_START).map(child => child.id)).toEqual([id])
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
      expect(history(id)).toEqual([[null, bears, true]])
    })

    it('deregisters a child that moved back out of such a group before its school start', () => {
      setGroupForSchoolChildren(db, hort, true)
      setAutoLeave(db, 1, true)
      const id = schoolChild({ groupId: hort })
      planGroupChange(db, admin, 1, id, change(bears, '2027-06-01'), TODAY, NOW)
      expect(leaveSchoolChildren(db, SCHOOL_START)).toBe(1)
      expect(leftOn(id)).toBe(DAY_BEFORE)
    })
  })

  describe('taking the leaving back', () => {
    beforeEach(() => {
      setAutoLeave(db, 1, true)
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

    it('asks for the new school start whatever the switch says and however the child was deregistered', () => {
      setAutoLeave(db, 1, false)
      const id = schoolChild()
      leaveChild(db, 1, id, '2027-09-05', '2027-09-05')
      expect(errorCode(() => unleaveChild(db, 1, id, '2027-09-10'))).toBe('school_start_required')
      unleaveChild(db, 1, id, '2027-09-10', '2027-09-11')
      expect(row(id)).toMatchObject({ leftOn: null, schoolStartDate: '2027-09-11' })
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

  describe('the daily run', () => {
    const plugin = readFileSync(join(process.cwd(), 'server', 'plugins', 'database.ts'), 'utf8')

    it('deregisters after applying the due group changes and before deleting expired records', () => {
      const applying = plugin.indexOf('applyDueGroupChanges(db')
      const leaving = plugin.indexOf('leaveSchoolChildren(db')
      const purging = plugin.indexOf('purgeExpiredChildren(db')
      expect(applying).toBeGreaterThan(-1)
      expect(leaving).toBeGreaterThan(applying)
      expect(purging).toBeGreaterThan(leaving)
    })

    it('logs the number only, never a name', () => {
      expect(plugin).toContain('`Deregistered ${deregistered} school child(ren).`')
      expect(plugin).toContain('\'Deregistering school children failed\'')
    })
  })
})
