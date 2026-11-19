import { describe, expect, it } from 'vitest'
import { getTabletSettings, setTabletSettings } from '../../server/services/tabletSettings'
import { addFacility, createTestDb, errorCode } from '../helpers/fixtures'

describe('tablet settings', () => {
  it('returns the defaults for a facility', () => {
    const db = createTestDb()
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [] })
  })

  it('stores the settings per facility', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Krippe')
    setTabletSettings(db, 1, { lockMinutes: 5, showWaitlist: true, showFutureContracts: false, noLockWindows: [] })
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 5, showWaitlist: true, showFutureContracts: false, noLockWindows: [] })
    expect(getTabletSettings(db, other)).toEqual({ lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [] })
  })

  it('accepts the limits of 1 and 30 minutes', () => {
    const db = createTestDb()
    setTabletSettings(db, 1, { lockMinutes: 1, showWaitlist: false, showFutureContracts: true, noLockWindows: [] })
    expect(getTabletSettings(db, 1).lockMinutes).toBe(1)
    setTabletSettings(db, 1, { lockMinutes: 30, showWaitlist: false, showFutureContracts: true, noLockWindows: [] })
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 30, showWaitlist: false, showFutureContracts: true, noLockWindows: [] })
  })

  it('refuses a lock time outside 1–30 minutes', () => {
    const db = createTestDb()
    for (const lockMinutes of [0, 31, 2.5]) {
      expect(errorCode(() => setTabletSettings(db, 1, { lockMinutes, showWaitlist: true, showFutureContracts: true })))
        .toBe('tablet_lock_minutes_invalid')
    }
    expect(getTabletSettings(db, 1)).toEqual({ lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [] })
  })

  it('answers 404 for an unknown facility', () => {
    const db = createTestDb()
    expect(errorCode(() => getTabletSettings(db, 99))).toBe('facility_not_found')
    expect(errorCode(() => setTabletSettings(db, 99, { lockMinutes: 3, showWaitlist: false, showFutureContracts: false })))
      .toBe('facility_not_found')
  })

  describe('windows without the automatic lock', () => {
    const base = { lockMinutes: 2, showWaitlist: false, showFutureContracts: false }

    it('stores the windows per facility, sorted by start, and replaces them as a whole', () => {
      const db = createTestDb()
      const other = addFacility(db, 'Krippe')
      setTabletSettings(db, 1, { ...base, noLockWindows: [{ start: 900, end: 960 }, { start: 420, end: 510 }] })
      expect(getTabletSettings(db, 1).noLockWindows).toEqual([{ start: 420, end: 510 }, { start: 900, end: 960 }])
      expect(getTabletSettings(db, other).noLockWindows).toEqual([])
      setTabletSettings(db, 1, { ...base, noLockWindows: [{ start: 450, end: 480 }] })
      expect(getTabletSettings(db, 1).noLockWindows).toEqual([{ start: 450, end: 480 }])
      setTabletSettings(db, 1, { ...base, noLockWindows: [] })
      expect(getTabletSettings(db, 1).noLockWindows).toEqual([])
    })

    it('keeps the windows when the request leaves them out', () => {
      const db = createTestDb()
      setTabletSettings(db, 1, { ...base, noLockWindows: [{ start: 420, end: 510 }] })
      setTabletSettings(db, 1, { ...base, lockMinutes: 5 })
      expect(getTabletSettings(db, 1)).toEqual({ ...base, lockMinutes: 5, noLockWindows: [{ start: 420, end: 510 }] })
    })

    it('accepts six windows, touching windows and 24:00', () => {
      const db = createTestDb()
      const six = Array.from({ length: 6 }, (_, index) => ({ start: index * 120, end: index * 120 + 120 }))
      setTabletSettings(db, 1, { ...base, noLockWindows: six })
      expect(getTabletSettings(db, 1).noLockWindows).toEqual(six)
      setTabletSettings(db, 1, { ...base, noLockWindows: [{ start: 1380, end: 1440 }] })
      expect(getTabletSettings(db, 1).noLockWindows).toEqual([{ start: 1380, end: 1440 }])
    })

    it('refuses „Bis“ not after „Von“, more than six windows, overlaps and invalid times, and stores nothing', () => {
      const db = createTestDb()
      setTabletSettings(db, 1, { ...base, noLockWindows: [{ start: 420, end: 510 }] })
      const refused = (noLockWindows: { start: number; end: number }[]) =>
        errorCode(() => setTabletSettings(db, 1, { ...base, lockMinutes: 9, noLockWindows }))
      expect(refused([{ start: 480, end: 480 }])).toBe('tablet_window_invalid')
      expect(refused([{ start: 600, end: 540 }])).toBe('tablet_window_invalid')
      expect(refused(Array.from({ length: 7 }, (_, index) => ({ start: index * 60, end: index * 60 + 30 })))).toBe('tablet_windows_too_many')
      expect(refused([{ start: 420, end: 540 }, { start: 500, end: 600 }])).toBe('tablet_windows_overlap')
      expect(refused([{ start: -5, end: 60 }])).toBe('tablet_window_time_invalid')
      expect(refused([{ start: 60, end: 1500 }])).toBe('tablet_window_time_invalid')
      expect(refused([{ start: 0, end: 1440 }])).toBe('tablet_window_too_long')
      expect(refused([{ start: 300, end: 300 + 14 * 60 + 5 }])).toBe('tablet_window_too_long')
      expect(getTabletSettings(db, 1)).toEqual({ ...base, noLockWindows: [{ start: 420, end: 510 }] })
    })
  })
})
