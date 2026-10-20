import { describe, expect, it } from 'vitest'
import { getReminderSettings, setGroupDocSettings, setReminderSettings } from '../../server/services/reminderSettings'
import type { DocSettings } from '../../shared/domain/reminders'
import { addFacility, addGroup, createTestDb, errorCode } from '../helpers/fixtures'

const OFF: DocSettings = { mode: 'off', intervalMonths: 12, leadWeeks: 2 }
const facilityInput = (overrides: Partial<Parameters<typeof setReminderSettings>[2]> = {}) => ({
  noGroupDoc: OFF, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4, ...overrides,
})

describe('reminder settings', () => {
  it('returns the defaults for the facility and each of its groups in their order', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    const maeuse = addGroup(db, 1, 'Mäuse')
    const other = addFacility(db, 'Krippe')
    addGroup(db, other, 'Wichtel')
    expect(getReminderSettings(db, 1)).toEqual({
      noGroupDoc: OFF, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4,
      groups: [{ groupId: baeren, name: 'Bären', doc: OFF }, { groupId: maeuse, name: 'Mäuse', doc: OFF }],
    })
  })

  it('stores the facility settings per facility', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    setReminderSettings(db, 1, {
      noGroupDoc: { mode: 'interval', intervalMonths: 6, leadWeeks: 3 },
      birthdayLeadDays: 14, staffBirthdayLeadDays: 0, leavingLeadWeeks: 8,
    })
    expect(getReminderSettings(db, 1)).toEqual({
      noGroupDoc: { mode: 'interval', intervalMonths: 6, leadWeeks: 3 },
      birthdayLeadDays: 14, staffBirthdayLeadDays: 0, leavingLeadWeeks: 8, groups: [],
    })
    expect(getReminderSettings(db, other)).toMatchObject({ noGroupDoc: OFF, birthdayLeadDays: 7, leavingLeadWeeks: 4 })
  })

  it('stores the documentation setting of a group and leaves the other groups as they are', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    const maeuse = addGroup(db, 1, 'Mäuse')
    setGroupDocSettings(db, 1, baeren, { mode: 'birthday', intervalMonths: 12, leadWeeks: 4 })
    expect(getReminderSettings(db, 1).groups).toEqual([
      { groupId: baeren, name: 'Bären', doc: { mode: 'birthday', intervalMonths: 12, leadWeeks: 4 } },
      { groupId: maeuse, name: 'Mäuse', doc: OFF },
    ])
    expect(getReminderSettings(db, 1).noGroupDoc).toEqual(OFF)
  })

  it('accepts the limits of every range', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setReminderSettings(db, 1, facilityInput({
      noGroupDoc: { mode: 'interval', intervalMonths: 1, leadWeeks: 0 }, birthdayLeadDays: 0, staffBirthdayLeadDays: 30, leavingLeadWeeks: 0,
    }))
    setGroupDocSettings(db, 1, baeren, { mode: 'interval', intervalMonths: 24, leadWeeks: 12 })
    setReminderSettings(db, 1, facilityInput({ birthdayLeadDays: 30, staffBirthdayLeadDays: 0, leavingLeadWeeks: 12 }))
    expect(getReminderSettings(db, 1)).toEqual({
      noGroupDoc: OFF, birthdayLeadDays: 30, staffBirthdayLeadDays: 0, leavingLeadWeeks: 12,
      groups: [{ groupId: baeren, name: 'Bären', doc: { mode: 'interval', intervalMonths: 24, leadWeeks: 12 } }],
    })
  })

  it('refuses values out of range or not whole numbers and changes nothing', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    const badDocs: DocSettings[] = [
      { mode: 'interval', intervalMonths: 0, leadWeeks: 2 }, { mode: 'interval', intervalMonths: 25, leadWeeks: 2 },
      { mode: 'interval', intervalMonths: 6.5, leadWeeks: 2 }, { mode: 'birthday', intervalMonths: 12, leadWeeks: -1 },
      { mode: 'birthday', intervalMonths: 12, leadWeeks: 13 }, { mode: 'yearly' as DocSettings['mode'], intervalMonths: 12, leadWeeks: 2 },
    ]
    for (const doc of badDocs) {
      expect(errorCode(() => setGroupDocSettings(db, 1, baeren, doc)), JSON.stringify(doc)).toBe('reminder_setting_invalid')
      expect(errorCode(() => setReminderSettings(db, 1, facilityInput({ noGroupDoc: doc }))), JSON.stringify(doc))
        .toBe('reminder_setting_invalid')
    }
    for (const bad of [
      { birthdayLeadDays: -1 }, { birthdayLeadDays: 31 }, { birthdayLeadDays: 1.5 }, { staffBirthdayLeadDays: 31 },
      { staffBirthdayLeadDays: -1 }, { leavingLeadWeeks: 13 }, { leavingLeadWeeks: -1 }, { leavingLeadWeeks: 0.5 },
    ]) {
      expect(errorCode(() => setReminderSettings(db, 1, facilityInput(bad))), JSON.stringify(bad)).toBe('reminder_setting_invalid')
    }
    expect(getReminderSettings(db, 1)).toEqual({
      noGroupDoc: OFF, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4,
      groups: [{ groupId: baeren, name: 'Bären', doc: OFF }],
    })
  })

  it('answers 404 for a group of another facility and leaves it untouched', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    const wichtel = addGroup(db, other, 'Wichtel')
    expect(errorCode(() => setGroupDocSettings(db, 1, wichtel, { mode: 'interval', intervalMonths: 6, leadWeeks: 2 })))
      .toBe('group_not_found')
    expect(errorCode(() => setGroupDocSettings(db, 1, 999, OFF))).toBe('group_not_found')
    expect(getReminderSettings(db, other).groups).toEqual([{ groupId: wichtel, name: 'Wichtel', doc: OFF }])
  })

  it('answers 404 for an unknown facility', () => {
    const db = createTestDb()
    expect(errorCode(() => getReminderSettings(db, 99))).toBe('facility_not_found')
    expect(errorCode(() => setReminderSettings(db, 99, facilityInput()))).toBe('facility_not_found')
  })
})
