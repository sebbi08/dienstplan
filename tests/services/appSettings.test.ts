import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { activeTrackingFrom, getTimeTrackingFrom, setTimeTrackingFrom } from '../../server/services/appSettings'
import { createTestDb } from '../helpers/fixtures'

describe('app settings', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })
  it('stores, replaces and clears the time tracking start date', () => {
    expect(getTimeTrackingFrom(db, 1)).toBeNull()
    setTimeTrackingFrom(db, 1, '2026-11-01')
    setTimeTrackingFrom(db, 1, '2026-10-15')
    expect(getTimeTrackingFrom(db, 1)).toBe('2026-10-15')
    setTimeTrackingFrom(db, 1, null)
    expect(getTimeTrackingFrom(db, 1)).toBeNull()
  })
  it('is active only from the start date on', () => {
    setTimeTrackingFrom(db, 1, '2026-11-01')
    expect(activeTrackingFrom(db, 1, '2026-10-31')).toBeNull()
    expect(activeTrackingFrom(db, 1, '2026-11-01')).toBe('2026-11-01')
  })
})
