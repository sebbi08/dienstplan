import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { facilities, groups, openingHours } from '../../server/db/schema'
import { openingHoursBodySchema } from '../../server/schemas'
import { createFacility } from '../../server/services/facilities'
import { deleteGroup } from '../../server/services/groups'
import { getOpeningHours, setFacilityOpeningHours, setGroupOpeningHours } from '../../server/services/openingHours'
import type { DayHours, OpeningHours } from '../../shared/domain/openingHours'
import { addFacility, addGroup, createTestDb, errorCode } from '../helpers/fixtures'

const none: DayHours = { open: null, close: null, closed: false }
const times = (open: number, close: number): DayHours => ({ open, close, closed: false })
const closed: DayHours = { open: null, close: null, closed: true }

/** Monday to Friday; the first entries are given, the rest are not entered. */
function week(days: DayHours[], minAtOpening = 1, minAtClosing = 1): OpeningHours {
  return { days: [...days, ...Array<DayHours>(5).fill(none)].slice(0, 5), minAtOpening, minAtClosing }
}

describe('opening hours', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('starts empty', () => {
    const kaefer = addGroup(db, 1, 'Käfer')
    expect(getOpeningHours(db, 1)).toEqual({ facility: null, groups: [{ groupId: kaefer, groupName: 'Käfer', hours: null }] })
  })

  it('stores and reads the facility hours with the minimum counts', () => {
    setFacilityOpeningHours(db, 1, week([times(420, 990), times(420, 990), closed], 2, 3))
    expect(getOpeningHours(db, 1).facility).toEqual(week([times(420, 990), times(420, 990), closed], 2, 3))
    // A new save replaces the old one.
    setFacilityOpeningHours(db, 1, week([none, times(480, 960)]))
    expect(getOpeningHours(db, 1).facility).toEqual(week([none, times(480, 960)]))
    expect(db.select().from(openingHours).all()).toHaveLength(1)
  })

  it('removes the facility hours with null and resets the minimum counts', () => {
    setFacilityOpeningHours(db, 1, week([times(420, 990)], 4, 5))
    setFacilityOpeningHours(db, 1, null)
    expect(getOpeningHours(db, 1).facility).toBeNull()
    setFacilityOpeningHours(db, 1, week([times(420, 990)]))
    expect(getOpeningHours(db, 1).facility).toMatchObject({ minAtOpening: 1, minAtClosing: 1 })
  })

  it('keeps the minimum counts although no weekday is entered, and resets them only with null', () => {
    const kaefer = addGroup(db, 1, 'Käfer')
    setFacilityOpeningHours(db, 1, week([times(420, 990)]))
    setFacilityOpeningHours(db, 1, week([], 3, 4))
    expect(getOpeningHours(db, 1).facility).toEqual(week([], 3, 4))
    expect(db.select().from(openingHours).all()).toEqual([])
    setGroupOpeningHours(db, 1, kaefer, week([], 2, 5))
    expect(getOpeningHours(db, 1).groups[0]!.hours).toEqual(week([], 2, 5))
    // Default counts and no weekday = no hours at all.
    setGroupOpeningHours(db, 1, kaefer, week([]))
    expect(getOpeningHours(db, 1).groups[0]!.hours).toBeNull()
    setFacilityOpeningHours(db, 1, null)
    expect(getOpeningHours(db, 1).facility).toBeNull()
  })

  it('stores group hours apart from the facility hours and removes them with null', () => {
    const kaefer = addGroup(db, 1, 'Käfer')
    const maeuse = addGroup(db, 1, 'Mäuse')
    setFacilityOpeningHours(db, 1, week([times(420, 990)]))
    setGroupOpeningHours(db, 1, kaefer, week([times(480, 900), closed], 2, 2))
    const read = getOpeningHours(db, 1)
    expect(read.facility).toEqual(week([times(420, 990)]))
    expect(read.groups).toEqual([
      { groupId: kaefer, groupName: 'Käfer', hours: week([times(480, 900), closed], 2, 2) },
      { groupId: maeuse, groupName: 'Mäuse', hours: null },
    ])
    setGroupOpeningHours(db, 1, kaefer, null)
    expect(getOpeningHours(db, 1).groups[0]).toEqual({ groupId: kaefer, groupName: 'Käfer', hours: null })
    expect(getOpeningHours(db, 1).facility).toEqual(week([times(420, 990)]))
  })

  it('refuses a close time that is not after the open time', () => {
    for (const day of [times(600, 600), times(600, 540)]) {
      expect(errorCode(() => setFacilityOpeningHours(db, 1, week([day])))).toBe('opening_hours_invalid')
    }
    expect(getOpeningHours(db, 1).facility).toBeNull()
  })

  it('names the other mistakes apart: one time only, times outside the day, a wrong number of days', () => {
    expect(errorCode(() => setFacilityOpeningHours(db, 1, week([{ open: 420, close: null, closed: false }])))).toBe('opening_hours_incomplete')
    expect(errorCode(() => setFacilityOpeningHours(db, 1, week([{ open: null, close: 990, closed: false }])))).toBe('opening_hours_incomplete')
    for (const day of [times(-5, 600), times(420, 1440), times(420, 1500), times(420.5, 600)]) {
      expect(errorCode(() => setFacilityOpeningHours(db, 1, week([day])))).toBe('invalid_time')
    }
    expect(errorCode(() => setFacilityOpeningHours(db, 1, { ...week([]), days: [none] }))).toBe('invalid_input')
    expect(getOpeningHours(db, 1).facility).toBeNull()
  })

  it('ignores the times of a closed day', () => {
    setFacilityOpeningHours(db, 1, week([{ open: 420, close: 990, closed: true }]))
    expect(getOpeningHours(db, 1).facility).toEqual(week([closed]))
  })

  it('refuses minimum counts outside 1 to 20', () => {
    for (const [atOpening, atClosing] of [[0, 1], [21, 1], [1, 0], [1, 21], [1.5, 1]]) {
      expect(errorCode(() => setFacilityOpeningHours(db, 1, week([times(420, 990)], atOpening, atClosing)))).toBe('opening_min_invalid')
    }
    setFacilityOpeningHours(db, 1, week([times(420, 990)], 1, 20))
    expect(getOpeningHours(db, 1).facility).toMatchObject({ minAtOpening: 1, minAtClosing: 20 })
    const kaefer = addGroup(db, 1, 'Käfer')
    expect(errorCode(() => setGroupOpeningHours(db, 1, kaefer, week([times(420, 990)], 0, 1)))).toBe('opening_min_invalid')
  })

  it('leaves a fractional minimum count to the service, so the answer is opening_min_invalid', () => {
    const body = openingHoursBodySchema.parse({ hours: { ...week([times(420, 990)]), minAtOpening: 1.5 } })
    expect(errorCode(() => setFacilityOpeningHours(db, 1, body.hours))).toBe('opening_min_invalid')
  })

  it('refuses a group of another facility with 404 and changes nothing', () => {
    const krippe = addFacility(db, 'Krippe')
    const raupen = addGroup(db, krippe, 'Raupen')
    expect(errorCode(() => setGroupOpeningHours(db, 1, raupen, week([times(420, 990)])))).toBe('group_not_found')
    expect(errorCode(() => setGroupOpeningHours(db, 1, 999, null))).toBe('group_not_found')
    expect(db.select().from(openingHours).all()).toEqual([])
    // The other facility's hours are its own.
    setGroupOpeningHours(db, krippe, raupen, week([times(420, 990)]))
    expect(getOpeningHours(db, 1).groups).toEqual([])
    expect(getOpeningHours(db, krippe).groups[0]!.hours).toEqual(week([times(420, 990)]))
  })

  it('keeps the hours of the facilities apart, and a new facility starts empty', () => {
    setFacilityOpeningHours(db, 1, week([times(420, 990)]))
    const second = createFacility(db, 'Krippe').id
    expect(getOpeningHours(db, second).facility).toBeNull()
    setFacilityOpeningHours(db, second, week([times(480, 900)]))
    expect(getOpeningHours(db, 1).facility).toEqual(week([times(420, 990)]))
  })

  it('has at most one facility row and one group row per weekday', () => {
    const kaefer = addGroup(db, 1, 'Käfer')
    const row = (groupId: number | null, weekday: number) => ({ facilityId: 1, groupId, weekday, open: 420, close: 990, closed: false })
    db.insert(openingHours).values(row(null, 0)).run()
    db.insert(openingHours).values(row(kaefer, 0)).run()
    // A second facility row for the same weekday is impossible although group_id is NULL, so is a second group row.
    expect(() => db.insert(openingHours).values(row(null, 0)).run()).toThrow(/UNIQUE/)
    expect(() => db.insert(openingHours).values(row(kaefer, 0)).run()).toThrow(/UNIQUE/)
    db.insert(openingHours).values(row(null, 1)).run()
  })

  it('deletes group hours with the group', () => {
    const kaefer = addGroup(db, 1, 'Käfer')
    setFacilityOpeningHours(db, 1, week([times(420, 990)]))
    setGroupOpeningHours(db, 1, kaefer, week([times(480, 900)]))
    deleteGroup(db, 1, kaefer, '2026-10-16')
    expect(db.select().from(openingHours).all().map(row => row.groupId)).toEqual([null])
  })

  it('deletes all hours with the facility', () => {
    const krippe = db.insert(facilities).values({ name: 'Krippe' }).returning().get().id
    const raupen = db.insert(groups).values({ facilityId: krippe, name: 'Raupen' }).returning().get().id
    setFacilityOpeningHours(db, krippe, week([times(420, 990)]))
    setGroupOpeningHours(db, krippe, raupen, week([times(480, 900)]))
    expect(db.select().from(openingHours).all()).toHaveLength(2)
    db.delete(groups).where(eq(groups.id, raupen)).run()
    expect(db.select().from(openingHours).all().map(row => row.groupId)).toEqual([null])
    db.delete(facilities).where(eq(facilities.id, krippe)).run()
    expect(db.select().from(openingHours).all()).toEqual([])
  })
})
