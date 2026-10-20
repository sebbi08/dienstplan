import { describe, expect, it } from 'vitest'
import { docSettingsSchema, reminderSettingsSchema } from '../../server/schemas'
import { getReminderSettings, setGroupDocSettings, setReminderSettings } from '../../server/services/reminderSettings'
import type { DocSettings } from '../../shared/domain/reminders'
import { addFacility, addGroup, createTestDb, errorCode } from '../helpers/fixtures'

const OFF: DocSettings = { mode: 'off', intervalMonths: 12, leadWeeks: 2 }
const TODAY = '2026-10-20'
const NOW = new Date('2026-10-20T08:00:00Z')
const facilityInput = (overrides: Partial<Parameters<typeof setReminderSettings>[2]> = {}) => ({
  noGroupDoc: OFF, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4, ...overrides,
})

describe('reminder settings, „gilt seit“', () => {
  const interval = (intervalMonths = 12, leadWeeks = 2): DocSettings => ({ mode: 'interval', intervalMonths, leadWeeks })
  const BIRTHDAY: DocSettings = { mode: 'birthday', intervalMonths: 12, leadWeeks: 2 }
  const later = (iso: string) => new Date(`${iso}T08:00:00Z`)
  const groupSince = (db: ReturnType<typeof createTestDb>) => getReminderSettings(db, 1).groups[0]!.docSince

  it('a group\'s setting gets today (Berlin) when it is switched on or the mode changes, not for months or lead weeks', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    // 22:30 UTC is already the next day in Berlin
    setGroupDocSettings(db, 1, baeren, interval(), new Date('2026-10-19T22:30:00Z'))
    expect(groupSince(db)).toBe(TODAY)
    setGroupDocSettings(db, 1, baeren, interval(6, 4), later('2026-11-05'))
    expect(groupSince(db)).toBe(TODAY)
    setGroupDocSettings(db, 1, baeren, BIRTHDAY, later('2026-12-01'))
    expect(groupSince(db)).toBe('2026-12-01')
    setGroupDocSettings(db, 1, baeren, { ...BIRTHDAY, leadWeeks: 6 }, later('2027-01-10'))
    expect(groupSince(db)).toBe('2026-12-01')
    setGroupDocSettings(db, 1, baeren, interval(), later('2027-02-01'))
    expect(groupSince(db)).toBe('2027-02-01')
    setGroupDocSettings(db, 1, baeren, OFF, later('2027-03-01'))
    expect(groupSince(db)).toBeNull()
    setGroupDocSettings(db, 1, baeren, interval(), later('2027-04-01'))
    expect(groupSince(db)).toBe('2027-04-01')
  })

  it('the setting for children without group behaves the same, and saving the lead times keeps it', () => {
    const db = createTestDb()
    setReminderSettings(db, 1, facilityInput({ noGroupDoc: interval() }), NOW)
    expect(getReminderSettings(db, 1).noGroupDocSince).toBe(TODAY)
    setReminderSettings(db, 1, facilityInput({ noGroupDoc: interval(3), birthdayLeadDays: 2 }), later('2026-11-01'))
    expect(getReminderSettings(db, 1).noGroupDocSince).toBe(TODAY)
    setReminderSettings(db, 1, facilityInput({ noGroupDoc: BIRTHDAY }), later('2026-11-02'))
    expect(getReminderSettings(db, 1).noGroupDocSince).toBe('2026-11-02')
    setReminderSettings(db, 1, facilityInput({ noGroupDoc: OFF }), later('2026-11-03'))
    expect(getReminderSettings(db, 1).noGroupDocSince).toBeNull()
  })
})

describe('reminder settings, „Beginn“ in interval mode', () => {
  const interval = (intervalMonths = 12, leadWeeks = 2): DocSettings => ({ mode: 'interval', intervalMonths, leadWeeks })
  const later = (iso: string) => new Date(`${iso}T08:00:00Z`)
  const groupSince = (db: ReturnType<typeof createTestDb>) => getReminderSettings(db, 1).groups[0]!.docSince

  it('stores a given start of a group, past or future, and returns it', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setGroupDocSettings(db, 1, baeren, { ...interval(), docSince: '2026-09-01' }, NOW)
    expect(groupSince(db)).toBe('2026-09-01')
    setGroupDocSettings(db, 1, baeren, { ...interval(6), docSince: '2027-09-01' }, later('2026-11-01'))
    expect(groupSince(db)).toBe('2027-09-01')
    expect(getReminderSettings(db, 1).groups[0]!.doc).toEqual(interval(6))
  })

  it('stores a given start of the children without group and returns it', () => {
    const db = createTestDb()
    setReminderSettings(db, 1, facilityInput({ noGroupDoc: { ...interval(), docSince: '2025-09-01' } }), NOW)
    expect(getReminderSettings(db, 1).noGroupDocSince).toBe('2025-09-01')
    expect(getReminderSettings(db, 1).noGroupDoc).toEqual(interval())
  })

  it('without a start keeps the automatic rule: today on a mode change, else unchanged', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setGroupDocSettings(db, 1, baeren, { ...interval(), docSince: '2026-09-01' }, NOW)
    setGroupDocSettings(db, 1, baeren, interval(6), later('2026-11-01'))
    expect(groupSince(db)).toBe('2026-09-01')
    setGroupDocSettings(db, 1, baeren, OFF, later('2026-11-03'))
    setGroupDocSettings(db, 1, baeren, interval(), later('2026-11-04'))
    expect(groupSince(db)).toBe('2026-11-04')
  })

  it('birthday mode keeps the automatic „gilt seit“ and „aus“ clears it, whatever start is sent', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setGroupDocSettings(db, 1, baeren, { mode: 'birthday', intervalMonths: 12, leadWeeks: 2, docSince: '2025-01-01' }, NOW)
    expect(groupSince(db)).toBe(TODAY)
    setGroupDocSettings(db, 1, baeren, { ...OFF, docSince: '2025-01-01' }, NOW)
    expect(groupSince(db)).toBeNull()
  })

  it('both routes pass the start on to the service, and leave it out when not sent', () => {
    const doc = { ...interval(), docSince: '2026-09-01' }
    expect(docSettingsSchema.parse(doc)).toEqual(doc)
    expect(docSettingsSchema.parse(interval())).toEqual(interval())
    expect(reminderSettingsSchema.parse(facilityInput({ noGroupDoc: doc })).noGroupDoc).toEqual(doc)
  })

  it('refuses an invalid start or one outside the years 2000–2100 (reminder_date_invalid) and changes nothing', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setGroupDocSettings(db, 1, baeren, { ...interval(), docSince: '2026-09-01' }, NOW)
    for (const docSince of ['2026-02-30', '2026-13-01', '01.09.2026', '', '2026-9-1', '1999-12-31', '2101-01-01', '0001-01-01']) {
      expect(errorCode(() => setGroupDocSettings(db, 1, baeren, { ...interval(6), docSince }, NOW)), docSince)
        .toBe('reminder_date_invalid')
      expect(errorCode(() => setReminderSettings(db, 1, facilityInput({ noGroupDoc: { ...interval(), docSince } }), NOW)), docSince)
        .toBe('reminder_date_invalid')
    }
    expect(getReminderSettings(db, 1).groups[0]).toMatchObject({ doc: interval(), docSince: '2026-09-01' })
    expect(getReminderSettings(db, 1).noGroupDocSince).toBeNull()
  })

  it('accepts a start on the first and the last day of the allowed years', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setGroupDocSettings(db, 1, baeren, { ...interval(), docSince: '2000-01-01' }, NOW)
    expect(groupSince(db)).toBe('2000-01-01')
    setGroupDocSettings(db, 1, baeren, { ...interval(), docSince: '2100-12-31' }, NOW)
    expect(groupSince(db)).toBe('2100-12-31')
  })
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
      noGroupDocSince: null,
      groups: [{ groupId: baeren, name: 'Bären', doc: OFF, docSince: null }, { groupId: maeuse, name: 'Mäuse', doc: OFF, docSince: null }],
    })
  })

  it('stores the facility settings per facility', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    setReminderSettings(db, 1, {
      noGroupDoc: { mode: 'interval', intervalMonths: 6, leadWeeks: 3 },
      birthdayLeadDays: 14, staffBirthdayLeadDays: 0, leavingLeadWeeks: 8,
    }, NOW)
    expect(getReminderSettings(db, 1)).toEqual({
      noGroupDoc: { mode: 'interval', intervalMonths: 6, leadWeeks: 3 },
      noGroupDocSince: TODAY, birthdayLeadDays: 14, staffBirthdayLeadDays: 0, leavingLeadWeeks: 8, groups: [],
    })
    expect(getReminderSettings(db, other)).toMatchObject({ noGroupDoc: OFF, birthdayLeadDays: 7, leavingLeadWeeks: 4 })
  })

  it('stores the documentation setting of a group and leaves the other groups as they are', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    const maeuse = addGroup(db, 1, 'Mäuse')
    setGroupDocSettings(db, 1, baeren, { mode: 'birthday', intervalMonths: 12, leadWeeks: 4 }, NOW)
    expect(getReminderSettings(db, 1).groups).toEqual([
      { groupId: baeren, name: 'Bären', doc: { mode: 'birthday', intervalMonths: 12, leadWeeks: 4 }, docSince: TODAY },
      { groupId: maeuse, name: 'Mäuse', doc: OFF, docSince: null },
    ])
    expect(getReminderSettings(db, 1).noGroupDoc).toEqual(OFF)
  })

  it('accepts the limits of every range', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    setReminderSettings(db, 1, facilityInput({
      noGroupDoc: { mode: 'interval', intervalMonths: 1, leadWeeks: 0 }, birthdayLeadDays: 0, staffBirthdayLeadDays: 30, leavingLeadWeeks: 0,
    }))
    setGroupDocSettings(db, 1, baeren, { mode: 'interval', intervalMonths: 24, leadWeeks: 12 }, NOW)
    setReminderSettings(db, 1, facilityInput({ birthdayLeadDays: 30, staffBirthdayLeadDays: 0, leavingLeadWeeks: 12 }))
    expect(getReminderSettings(db, 1)).toEqual({
      noGroupDoc: OFF, birthdayLeadDays: 30, staffBirthdayLeadDays: 0, leavingLeadWeeks: 12,
      noGroupDocSince: null, groups: [{ groupId: baeren, name: 'Bären', doc: { mode: 'interval', intervalMonths: 24, leadWeeks: 12 }, docSince: TODAY }],
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
      noGroupDocSince: null, groups: [{ groupId: baeren, name: 'Bären', doc: OFF, docSince: null }],
    })
  })

  it('answers 404 for a group of another facility and leaves it untouched', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    const wichtel = addGroup(db, other, 'Wichtel')
    expect(errorCode(() => setGroupDocSettings(db, 1, wichtel, { mode: 'interval', intervalMonths: 6, leadWeeks: 2 })))
      .toBe('group_not_found')
    expect(errorCode(() => setGroupDocSettings(db, 1, 999, OFF))).toBe('group_not_found')
    expect(getReminderSettings(db, other).groups).toEqual([{ groupId: wichtel, name: 'Wichtel', doc: OFF, docSince: null }])
  })

  it('answers 404 for an unknown facility', () => {
    const db = createTestDb()
    expect(errorCode(() => getReminderSettings(db, 99))).toBe('facility_not_found')
    expect(errorCode(() => setReminderSettings(db, 99, facilityInput()))).toBe('facility_not_found')
  })
})
