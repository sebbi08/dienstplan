import { describe, expect, it } from 'vitest'
import {
  MAX_NO_LOCK_WINDOWS, berlinInstant, noLockPeriods, noLockUntil, noLockWindowsError, sortedWindows, unlockDeadline,
  type NoLockPeriod, type TimeWindow,
} from '../../shared/domain/tablet'

const MIN = 60_000
const w = (start: number, end: number): TimeWindow => ({ start, end })
/** 2026-10-06 (a Tuesday, summer time: Berlin = UTC+2). */
const day = '2026-10-06'
const berlin = (minutes: number, date = day) => berlinInstant(date, minutes)

describe('berlinInstant', () => {
  it('turns a Berlin wall clock time into the moment, in summer and in winter time', () => {
    expect(new Date(berlinInstant('2026-10-06', 7 * 60 + 30)).toISOString()).toBe('2026-10-06T05:30:00.000Z')
    expect(new Date(berlinInstant('2026-12-01', 7 * 60 + 30)).toISOString()).toBe('2026-12-01T06:30:00.000Z')
    expect(new Date(berlinInstant('2026-10-06', 1440)).toISOString()).toBe('2026-10-06T22:00:00.000Z')
    expect(new Date(berlinInstant('2026-10-25', 12 * 60)).toISOString()).toBe('2026-10-25T11:00:00.000Z')
  })
})

describe('noLockWindowsError (settings check)', () => {
  it('accepts no windows, up to six, touching windows and 0:00 to 24:00', () => {
    expect(noLockWindowsError([])).toBeNull()
    expect(noLockWindowsError([w(0, 60), w(60, 120), w(1380, 1440)])).toBeNull()
    expect(noLockWindowsError(Array.from({ length: MAX_NO_LOCK_WINDOWS }, (_, index) => w(index * 60, index * 60 + 30)))).toBeNull()
  })

  it('refuses more than six windows', () => {
    expect(MAX_NO_LOCK_WINDOWS).toBe(6)
    expect(noLockWindowsError(Array.from({ length: 7 }, (_, index) => w(index * 60, index * 60 + 30))))
      .toEqual({ code: 'tablet_windows_too_many', row: null })
  })

  it('refuses „Bis“ not after „Von“', () => {
    expect(noLockWindowsError([w(420, 480), w(900, 900)])).toEqual({ code: 'tablet_window_invalid', row: 2 })
    expect(noLockWindowsError([w(900, 840)])).toEqual({ code: 'tablet_window_invalid', row: 1 })
  })

  it('refuses times that are no minute of the day', () => {
    for (const window of [w(-1, 60), w(0, 1441), w(1440, 1440), w(7.5, 60), w(Number.NaN, 60)]) {
      expect(noLockWindowsError([window])).toEqual({ code: 'invalid_time', row: 1 })
    }
  })

  it('refuses overlapping windows and names the later row', () => {
    expect(noLockWindowsError([w(420, 540), w(500, 600)])).toEqual({ code: 'tablet_windows_overlap', row: 2 })
    expect(noLockWindowsError([w(900, 960), w(420, 480), w(450, 930)])).toEqual({ code: 'tablet_windows_overlap', row: 3 })
  })

  it('sorts the windows by start', () => {
    expect(sortedWindows([w(900, 960), w(420, 480)])).toEqual([w(420, 480), w(900, 960)])
  })
})

describe('noLockPeriods', () => {
  it('gives the moments of the windows on the given open days, touching windows and days joined', () => {
    expect(noLockPeriods([w(900, 960), w(420, 480)], [day])).toEqual([
      { from: berlin(420), until: berlin(480) }, { from: berlin(900), until: berlin(960) },
    ])
    expect(noLockPeriods([w(420, 480), w(480, 510)], [day])).toEqual([{ from: berlin(420), until: berlin(510) }])
    expect(noLockPeriods([w(0, 60), w(1380, 1440)], [day, '2026-10-07'])).toEqual([
      { from: berlin(0), until: berlin(60) },
      { from: berlin(1380), until: berlin(60, '2026-10-07') },
      { from: berlin(1380, '2026-10-07'), until: berlin(1440, '2026-10-07') },
    ])
    expect(noLockPeriods([], [day])).toEqual([])
  })
})

describe('unlockDeadline (expiry with windows)', () => {
  const lock = 2 * MIN
  // Window 7:30–8:00 and 15:00–16:00.
  const periods: NoLockPeriod[] = noLockPeriods([w(450, 480), w(900, 960)], [day])

  it('is last use plus lock time without windows', () => {
    expect(unlockDeadline(berlin(600), lock, [])).toBe(berlin(602))
    expect(unlockDeadline(berlin(600), lock, periods)).toBe(berlin(602))
  })

  it('does not run out inside a window: window end plus lock time', () => {
    expect(unlockDeadline(berlin(455), lock, periods)).toBe(berlin(482))
  })

  it('takes the later of last use and window end after the window', () => {
    expect(unlockDeadline(berlin(479), lock, periods)).toBe(berlin(482))
    expect(unlockDeadline(berlin(481), lock, periods)).toBe(berlin(483))
  })

  it('carries an unlock still alive when the window starts through the window (last use before it)', () => {
    expect(unlockDeadline(berlin(449), lock, periods)).toBe(berlin(482))
    expect(unlockDeadline(berlin(448), lock, periods)).toBe(berlin(482))
  })

  it('does not revive an unlock that ran out before the window started', () => {
    expect(unlockDeadline(berlin(447), lock, periods)).toBe(berlin(449))
    expect(unlockDeadline(berlin(420), lock, periods)).toBe(berlin(422))
  })

  it('treats an unlock started inside the window and used after it by the last use', () => {
    // Unlocked 7:40 (inside), used again 8:05 (after the window): 8:07.
    expect(unlockDeadline(berlin(460), lock, periods)).toBe(berlin(482))
    expect(unlockDeadline(berlin(485), lock, periods)).toBe(berlin(487))
  })

  it('chains windows the unlock reaches alive', () => {
    const close = noLockPeriods([w(450, 480), w(481, 500)], [day])
    expect(unlockDeadline(berlin(455), lock, close)).toBe(berlin(502))
  })
})

describe('noLockUntil', () => {
  const periods = noLockPeriods([w(450, 480)], [day])
  it('is the end of the window the moment lies in, else null', () => {
    expect(noLockUntil(berlin(450), periods)).toBe(berlin(480))
    expect(noLockUntil(berlin(479), periods)).toBe(berlin(480))
    expect(noLockUntil(berlin(480), periods)).toBeNull()
    expect(noLockUntil(berlin(449), periods)).toBeNull()
  })
})
