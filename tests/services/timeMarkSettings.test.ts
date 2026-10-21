import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { timeMarkSettingsSchema } from '../../server/schemas'
import { getTimeMarkSettings, setTimeMarkSettings } from '../../server/services/timeMarkSettings'
import { addFacility, createTestDb, errorCode } from '../helpers/fixtures'

describe('time mark settings', () => {
  it('returns the defaults: 5 minutes, early leaving marked', () => {
    const db = createTestDb()
    expect(getTimeMarkSettings(db, 1)).toEqual({ toleranceMinutes: 5, markEarlyLeave: true })
  })

  it('stores the settings per facility', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    setTimeMarkSettings(db, 1, { toleranceMinutes: 10, markEarlyLeave: false })
    expect(getTimeMarkSettings(db, 1)).toEqual({ toleranceMinutes: 10, markEarlyLeave: false })
    expect(getTimeMarkSettings(db, other)).toEqual({ toleranceMinutes: 5, markEarlyLeave: true })
  })

  it('accepts the limits of 0 and 60 minutes', () => {
    const db = createTestDb()
    setTimeMarkSettings(db, 1, { toleranceMinutes: 0, markEarlyLeave: true })
    expect(getTimeMarkSettings(db, 1).toleranceMinutes).toBe(0)
    setTimeMarkSettings(db, 1, { toleranceMinutes: 60, markEarlyLeave: true })
    expect(getTimeMarkSettings(db, 1).toleranceMinutes).toBe(60)
  })

  it('refuses a tolerance outside 0–60 whole minutes without changing anything', () => {
    const db = createTestDb()
    for (const toleranceMinutes of [-1, 61, 2.5, Number.NaN]) {
      expect(errorCode(() => setTimeMarkSettings(db, 1, { toleranceMinutes, markEarlyLeave: false }))).toBe('mark_tolerance_invalid')
    }
    expect(getTimeMarkSettings(db, 1)).toEqual({ toleranceMinutes: 5, markEarlyLeave: true })
  })

  it('lets an empty field through the schema so the service answers its own German error', () => {
    const db = createTestDb()
    for (const toleranceMinutes of ['', null]) {
      const input = timeMarkSettingsSchema.parse({ toleranceMinutes, markEarlyLeave: true })
      expect(errorCode(() => setTimeMarkSettings(db, 1, input))).toBe('mark_tolerance_invalid')
    }
    expect(() => timeMarkSettingsSchema.parse({ toleranceMinutes: 'abc', markEarlyLeave: true })).toThrow()
    expect(de.errors.mark_tolerance_invalid).toContain('0 bis 60')
  })

  it('answers 404 for an unknown facility', () => {
    const db = createTestDb()
    expect(errorCode(() => getTimeMarkSettings(db, 99))).toBe('facility_not_found')
    expect(errorCode(() => setTimeMarkSettings(db, 99, { toleranceMinutes: 5, markEarlyLeave: true }))).toBe('facility_not_found')
  })
})
