import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getChild } from '../../server/services/children'
import { getSchoolSettings, occupancyChildren, setSchoolCutoff } from '../../server/services/schoolChildren'
import type { FacilityUser } from '../../server/utils/auth'
import { addChild, addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-13'

describe('school settings of a facility', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('starts with 30 June and six years', () => {
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6 })
  })

  it('stores the cutoff per facility', () => {
    const krippe = addFacility(db, 'Krippe')
    setSchoolCutoff(db, 1, { cutoffMonth: 9, cutoffDay: 30, ageYears: 5 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 9, cutoffDay: 30, ageYears: 5 })
    expect(getSchoolSettings(db, krippe)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6 })
  })

  it('accepts 29 February and the age limits 4 and 8', () => {
    setSchoolCutoff(db, 1, { cutoffMonth: 2, cutoffDay: 29, ageYears: 4 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 2, cutoffDay: 29, ageYears: 4 })
    setSchoolCutoff(db, 1, { cutoffMonth: 12, cutoffDay: 31, ageYears: 8 })
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 12, cutoffDay: 31, ageYears: 8 })
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
    expect(getSchoolSettings(db, 1)).toEqual({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6 })
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

    expect(result.children.map(child => child.id).sort()).toEqual([planned, left, manual].sort())
    const byId = new Map(result.children.map(child => [child.id, child]))
    // Born on the cutoff: school start 1 September 2027, so the stay ends on 31 August 2027.
    expect(byId.get(planned)).toEqual({ id: planned, start: '2026-11-01', end: '2027-08-31', groups: [{ from: null, groupId: bears }] })
    // A recorded leaving day wins over the school start.
    expect(byId.get(left)).toMatchObject({ start: '2025-09-01', end: '2026-03-15', groups: [{ from: null, groupId: null }] })
    // A later manual school start moves the end.
    expect(byId.get(manual)).toMatchObject({ end: '2028-08-31' })
    expect(result.names).toEqual({ [planned]: 'Lena Meier', [left]: 'Ben Arnold', [manual]: 'Zoe Klein' })
    expect(result.undated).toEqual([])
  })

  it('reports contract children without a start as undated and does not count them', () => {
    const nameless = addChild(db, 1, { firstName: 'Mia', lastName: 'Weber', entryDate: null, plannedEntryDate: null })
    addChild(db, 1, { firstName: 'Vorgemerkt', admissionStatus: 'waitlist', entryDate: null })
    const result = occupancyChildren(db, 1)
    expect(result.undated).toEqual([{ id: nameless, name: 'Mia Weber' }])
    expect(result.children.find(child => child.id === nameless)?.start).toBeNull()
  })

  it('uses the facility\'s own cutoff', () => {
    const id = addChild(db, 1, { birthDate: '2021-07-01' })
    expect(occupancyChildren(db, 1).children.find(child => child.id === id)?.end).toBe('2028-08-31')
    setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
    expect(occupancyChildren(db, 1).children.find(child => child.id === id)?.end).toBe('2027-08-31')
  })
})
