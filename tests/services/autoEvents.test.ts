import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges, childParentMeetings, employees } from '../../server/db/schema'
import { autoEventsFor } from '../../server/services/autoEvents'
import type { MeetingKind } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, createTestDb } from '../helpers/fixtures'

const createdAt = '2026-01-01T00:00:00.000Z'

describe('automatic day events', () => {
  let db: Db
  let baeren: number
  let maeuse: number

  beforeEach(() => {
    db = createTestDb()
    baeren = addGroup(db, 1, 'Bären')
    maeuse = addGroup(db, 1, 'Mäuse')
  })

  const october = () => Object.fromEntries(autoEventsFor(db, 1, '2026-10-01', '2026-10-31'))
  const meeting = (childId: number, date: string, start: number, kind: MeetingKind = 'development', note = '') =>
    db.insert(childParentMeetings).values({ childId, date, start, end: null, kind, note, createdAt }).run()
  const moveChild = (childId: number, groupId: number | null, fromDate: string) =>
    db.insert(childGroupChanges).values({ childId, groupId, fromDate, appliedAt: createdAt, createdAt }).run()
  const staffBirthday = (name: string, birthday: string, options: { leftOn?: string | null; facilityId?: number } = {}) => {
    const id = addEmployee(db, name, options)
    db.update(employees).set({ birthday }).where(eq(employees.id, id)).run()
    return id
  }

  it('has no events without children, meetings or birthdays', () => {
    expect(october()).toEqual({})
  })

  describe('Eingewöhnung', () => {
    it('falls on the entry day with the group of that day, counted per group', () => {
      addChild(db, 1, { entryDate: '2026-10-05', groupId: baeren })
      addChild(db, 1, { entryDate: '2026-10-05', groupId: baeren })
      addChild(db, 1, { entryDate: '2026-10-05', groupId: maeuse })
      addChild(db, 1, { entryDate: '2026-10-06', groupId: null })
      expect(october()).toEqual({
        '2026-10-05': ['2× Eingewöhnung (Bären)', 'Eingewöhnung (Mäuse)'],
        '2026-10-06': ['Eingewöhnung'],
      })
    })

    it('is not given by a planned entry, a waitlist child, another facility or an entry outside the range', () => {
      addChild(db, 1, { entryDate: null, plannedEntryDate: '2026-10-05', groupId: baeren })
      addChild(db, 1, { admissionStatus: 'waitlist', entryDate: '2026-10-05', groupId: baeren })
      const other = addFacility(db, 'Krippe')
      addChild(db, other, { entryDate: '2026-10-05', groupId: addGroup(db, other, 'Füchse') })
      addChild(db, 1, { entryDate: '2026-11-02', groupId: baeren })
      expect(october()).toEqual({})
    })
  })

  describe('Elterngespräch', () => {
    it('lists one line per time and group, by time, never the note', () => {
      const kid1 = addChild(db, 1, { groupId: baeren })
      const kid2 = addChild(db, 1, { groupId: baeren })
      const kid3 = addChild(db, 1, { groupId: maeuse })
      const kid4 = addChild(db, 1, { groupId: null })
      meeting(kid1, '2026-10-07', 840, 'development', 'Vertraulich')
      meeting(kid2, '2026-10-07', 840, 'final')
      meeting(kid3, '2026-10-07', 570)
      meeting(kid4, '2026-10-07', 840)
      meeting(kid1, '2026-10-02', 605, 'settling_in') // a past meeting counts too
      meeting(kid1, '2026-11-02', 600)
      const events = october()
      expect(events).toEqual({
        '2026-10-02': ['Elterngespräch 10:05 (Bären)'],
        '2026-10-07': ['Elterngespräch 9:30 (Mäuse)', '2× Elterngespräch 14:00 (Bären)', 'Elterngespräch 14:00'],
      })
      expect(JSON.stringify(events)).not.toContain('Vertraulich')
    })

    it('shows the group the child is in on the meeting day', () => {
      const kid = addChild(db, 1, { groupId: baeren })
      moveChild(kid, maeuse, '2026-10-10')
      meeting(kid, '2026-10-09', 600)
      meeting(kid, '2026-10-12', 600)
      expect(october()).toMatchObject({
        '2026-10-09': ['Elterngespräch 10:00 (Bären)'],
        '2026-10-12': ['Elterngespräch 10:00 (Mäuse)'],
      })
    })

    it('leaves out meetings of another facility\'s children', () => {
      const other = addFacility(db, 'Krippe')
      meeting(addChild(db, other), '2026-10-07', 600)
      expect(october()).toEqual({})
    })
  })

  describe('Kindergeburtstag', () => {
    it('falls on the birthday of an active child, counted per group', () => {
      addChild(db, 1, { birthDate: '2022-10-12', groupId: baeren })
      addChild(db, 1, { birthDate: '2023-10-12', groupId: baeren })
      addChild(db, 1, { birthDate: '2021-10-12', groupId: null })
      expect(october()).toEqual({ '2026-10-12': ['2× Kindergeburtstag (Bären)', 'Kindergeburtstag'] })
    })

    it('shows the group of the birthday when the child changes group in the month (Review Focus 2)', () => {
      const kid = addChild(db, 1, { birthDate: '2022-10-14', groupId: baeren })
      moveChild(kid, maeuse, '2026-10-10')
      expect(october()).toEqual({ '2026-10-14': ['Kindergeburtstag (Mäuse)'] })
    })

    it('is left out for a child who left before it (Review Focus 3), not yet entered, waitlisted or elsewhere', () => {
      addChild(db, 1, { birthDate: '2022-10-14', groupId: baeren, leftOn: '2026-10-10' })
      addChild(db, 1, { birthDate: '2022-10-14', groupId: baeren, entryDate: '2026-11-01' })
      addChild(db, 1, { birthDate: '2022-10-14', groupId: baeren, entryDate: null, admissionStatus: 'waitlist' })
      const other = addFacility(db, 'Krippe')
      addChild(db, other, { birthDate: '2022-10-14' })
      expect(october()).toEqual({})
    })

    it('still counts on the leaving day itself', () => {
      addChild(db, 1, { birthDate: '2022-10-14', groupId: baeren, leftOn: '2026-10-14' })
      expect(october()).toEqual({ '2026-10-14': ['Kindergeburtstag (Bären)'] })
    })

    it('names no group of another facility from before the child moved here', () => {
      const other = addFacility(db, 'Krippe')
      const foreign = addGroup(db, other, 'Füchse')
      addChild(db, 1, { birthDate: '2022-10-14', groupId: foreign })
      expect(october()).toEqual({ '2026-10-14': ['Kindergeburtstag'] })
    })

    it('puts 29 February on 28 February in non-leap years', () => {
      addChild(db, 1, { birthDate: '2020-02-29', groupId: baeren })
      expect(Object.fromEntries(autoEventsFor(db, 1, '2027-02-01', '2027-03-31')))
        .toEqual({ '2027-02-28': ['Kindergeburtstag (Bären)'] })
      expect(Object.fromEntries(autoEventsFor(db, 1, '2028-02-01', '2028-03-31')))
        .toEqual({ '2028-02-29': ['Kindergeburtstag (Bären)'] })
    })

    it('finds every birthday of a range over a year boundary', () => {
      addChild(db, 1, { birthDate: '2022-01-03', entryDate: '2024-09-01', groupId: baeren })
      expect([...autoEventsFor(db, 1, '2026-01-01', '2027-12-31').keys()]).toEqual(['2026-01-03', '2027-01-03'])
    })
  })

  describe('Mitarbeiter-Geburtstag', () => {
    it('names the employees of the facility by name, in name order', () => {
      staffBirthday('Berta Beispiel', '10-15')
      staffBirthday('Anna Arm', '10-15')
      addEmployee(db, 'Carla') // no birthday given
      staffBirthday('Dora', '10-15', { facilityId: addFacility(db, 'Krippe') })
      expect(october()).toEqual({ '2026-10-15': ['Geburtstag Anna Arm', 'Geburtstag Berta Beispiel'] })
    })

    it('leaves out who left before the day, not who leaves on it', () => {
      staffBirthday('Anna', '10-15', { leftOn: '2026-10-14' })
      staffBirthday('Berta', '10-15', { leftOn: '2026-10-15' })
      expect(october()).toEqual({ '2026-10-15': ['Geburtstag Berta'] })
    })

    it('puts 29 February on 28 February in non-leap years', () => {
      staffBirthday('Anna', '02-29')
      expect([...autoEventsFor(db, 1, '2027-02-01', '2028-03-31').keys()]).toEqual(['2027-02-28', '2028-02-29'])
    })
  })

  it('orders a day: Eingewöhnung, Elterngespräch by time, Kindergeburtstag, Geburtstag', () => {
    staffBirthday('Zoe', '10-20')
    addChild(db, 1, { birthDate: '2022-10-20', groupId: baeren })
    const kid = addChild(db, 1, { groupId: maeuse })
    meeting(kid, '2026-10-20', 900)
    meeting(kid, '2026-10-20', 480)
    addChild(db, 1, { entryDate: '2026-10-20', groupId: maeuse })
    expect(october()['2026-10-20']).toEqual([
      'Eingewöhnung (Mäuse)',
      'Elterngespräch 8:00 (Mäuse)',
      'Elterngespräch 15:00 (Mäuse)',
      'Kindergeburtstag (Bären)',
      'Geburtstag Zoe',
    ])
  })
})
