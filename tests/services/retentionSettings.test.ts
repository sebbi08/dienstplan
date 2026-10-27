import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { retentionSettings } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { getRetentionSettings, setRetentionSettings } from '../../server/services/retentionSettings'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import { addFacility, createTestDb, errorCode } from '../helpers/fixtures'

const valid = { timeYears: 4, assessmentYears: 5, paidOvertimeYears: 12, pensionYears: 35, cashYears: 8, employeeDelete: 'provider' }

describe('retention settings', () => {
  let db: Db
  let hort: number
  beforeEach(() => {
    db = createTestDb()
    hort = addFacility(db, 'Hort')
  })

  it('answers the defaults and creates the facility row on first read', () => {
    expect(db.select().from(retentionSettings).all()).toEqual([])
    expect(getRetentionSettings(db, 1)).toEqual(RETENTION_DEFAULTS)
    expect(db.select().from(retentionSettings).all()).toEqual([{ facilityId: 1, ...RETENTION_DEFAULTS }])
    expect(getRetentionSettings(db, 1)).toEqual(RETENTION_DEFAULTS)
    expect(db.select().from(retentionSettings).all()).toHaveLength(1)
  })

  it('stores the settings per facility and answers them as stored', () => {
    expect(setRetentionSettings(db, hort, valid)).toEqual(valid)
    expect(getRetentionSettings(db, hort)).toEqual(valid)
    expect(getRetentionSettings(db, 1)).toEqual(RETENTION_DEFAULTS)
    // A second change replaces the first.
    setRetentionSettings(db, hort, { ...valid, timeYears: 1, employeeDelete: 'off' })
    expect(getRetentionSettings(db, hort)).toMatchObject({ timeYears: 1, employeeDelete: 'off', cashYears: 8 })
  })

  it('refuses invalid input with 400 and keeps what was stored', () => {
    setRetentionSettings(db, 1, valid)
    const invalid = [
      { ...valid, timeYears: 0 }, { ...valid, assessmentYears: 41 }, { ...valid, paidOvertimeYears: 2.5 },
      { ...valid, pensionYears: '30' }, { ...valid, cashYears: 31 }, { ...valid, employeeDelete: 'everyone' },
      { ...valid, timeYears: undefined }, null, [], 'x',
    ]
    for (const input of invalid) {
      expect(errorCode(() => setRetentionSettings(db, 1, input)), JSON.stringify(input)).toBe('retention_settings_invalid')
    }
    try {
      setRetentionSettings(db, 1, { ...valid, timeYears: 0 })
    }
    catch (error) {
      expect((error as ServiceError).statusCode).toBe(400)
    }
    expect(getRetentionSettings(db, 1)).toEqual(valid)
    // The limits themselves are allowed.
    expect(setRetentionSettings(db, 1, { ...valid, timeYears: 1, assessmentYears: 40, cashYears: 30 }))
      .toMatchObject({ timeYears: 1, assessmentYears: 40, cashYears: 30 })
  })

  it('answers 404 for a facility that does not exist', () => {
    expect(errorCode(() => getRetentionSettings(db, 999))).toBe('facility_not_found')
    expect(errorCode(() => setRetentionSettings(db, 999, valid))).toBe('facility_not_found')
    expect(db.select().from(retentionSettings).where(eq(retentionSettings.facilityId, 999)).all()).toEqual([])
  })
})
