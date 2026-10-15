import { describe, expect, it } from 'vitest'
import { getTabletSettings, setTabletSettings } from '../../server/services/tabletSettings'
import { addFacility, createTestDb, errorCode } from '../helpers/fixtures'

describe('tablet settings', () => {
  it('returns the defaults for a facility', () => {
    const db = createTestDb()
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 2, showWaitlist: false, showFutureContracts: false })
  })

  it('stores the settings per facility', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    setTabletSettings(db, 1, { lockMinutes: 5, showWaitlist: true, showFutureContracts: false })
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 5, showWaitlist: true, showFutureContracts: false })
    expect(getTabletSettings(db, other)).toEqual({ lockMinutes: 2, showWaitlist: false, showFutureContracts: false })
  })

  it('accepts the limits of 1 and 30 minutes', () => {
    const db = createTestDb()
    setTabletSettings(db, 1, { lockMinutes: 1, showWaitlist: false, showFutureContracts: true })
    expect(getTabletSettings(db, 1).lockMinutes).toBe(1)
    setTabletSettings(db, 1, { lockMinutes: 30, showWaitlist: false, showFutureContracts: true })
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 30, showWaitlist: false, showFutureContracts: true })
  })

  it('refuses a lock time outside 1–30 minutes', () => {
    const db = createTestDb()
    for (const lockMinutes of [0, 31, 2.5]) {
      expect(errorCode(() => setTabletSettings(db, 1, { lockMinutes, showWaitlist: true, showFutureContracts: true })))
        .toBe('tablet_lock_minutes_invalid')
    }
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 2, showWaitlist: false, showFutureContracts: false })
  })

  it('answers 404 for an unknown facility', () => {
    const db = createTestDb()
    expect(errorCode(() => getTabletSettings(db, 99))).toBe('facility_not_found')
    expect(errorCode(() => setTabletSettings(db, 99, { lockMinutes: 3, showWaitlist: false, showFutureContracts: false })))
      .toBe('facility_not_found')
  })
})
