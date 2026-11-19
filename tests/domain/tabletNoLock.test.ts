import { describe, expect, it } from 'vitest'
import {
  MAX_NO_LOCK_WINDOWS, MAX_UNBOUNDED_WINDOW_MINUTES, berlinDate, berlinInstant, noLockPeriods, noLockUntil, noLockWindowsError,
  sortedWindows, unlockDeadline, windowsOnDay, type NoLockPeriod, type TimeWindow,
} from '../../shared/domain/tablet'

const MIN = 60_000
const w = (start: number, end: number): TimeWindow => ({ start, end })
/** 2026-10-06 (a Tuesday, summer time: Berlin = UTC+2). */
const day = '2026-10-06'
const next = '2026-10-07'
const berlin = (minutes: number, date = day) => berlinInstant(date, minutes)

describe('berlinInstant / berlinDate', () => {
  it('turns a Berlin wall clock time into the moment, in summer and in winter time', () => {
    expect(new Date(berlinInstant('2026-10-06', 7 * 60 + 30)).toISOString()).toBe('2026-10-06T05:30:00.000Z')
    expect(new Date(berlinInstant('2026-12-01', 7 * 60 + 30)).toISOString()).toBe('2026-12-01T06:30:00.000Z')
    expect(new Date(berlinInstant('2026-10-06', 1440)).toISOString()).toBe('2026-10-06T22:00:00.000Z')
    expect(new Date(berlinInstant('2026-10-25', 12 * 60)).toISOString()).toBe('2026-10-25T11:00:00.000Z')
  })

  it('gives the Berlin date of a moment', () => {
    expect(berlinDate(Date.parse('2026-10-06T21:59:00Z'))).toBe('2026-10-06')
    expect(berlinDate(Date.parse('2026-10-06T22:00:00Z'))).toBe('2026-10-07')
  })
})

describe('noLockWindowsError (settings check)', () => {
  it('accepts no windows, up to six and touching windows', () => {
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
      expect(noLockWindowsError([window])).toEqual({ code: 'tablet_window_time_invalid', row: 1 })
    }
  })

  it('refuses overlapping windows and names the later row', () => {
    expect(noLockWindowsError([w(420, 540), w(500, 600)])).toEqual({ code: 'tablet_windows_overlap', row: 2 })
    expect(noLockWindowsError([w(900, 960), w(420, 480), w(450, 930)])).toEqual({ code: 'tablet_windows_overlap', row: 3 })
  })

  it('without opening hours refuses 0:00–24:00 and windows over 14 hours', () => {
    expect(MAX_UNBOUNDED_WINDOW_MINUTES).toBe(14 * 60)
    expect(noLockWindowsError([w(0, 1440)], { limitLength: true })).toEqual({ code: 'tablet_window_too_long', row: 1 })
    expect(noLockWindowsError([w(60, 120), w(360, 360 + 14 * 60 + 1)], { limitLength: true })).toEqual({ code: 'tablet_window_too_long', row: 2 })
    expect(noLockWindowsError([w(360, 360 + 14 * 60)], { limitLength: true })).toBeNull()
    expect(noLockWindowsError([w(0, 1440)])).toBeNull()
  })

  it('without opening hours refuses windows spanning more than 14 hours together, touching or not', () => {
    const limited = { limitLength: true }
    expect(noLockWindowsError([w(0, 840), w(840, 1440)], limited)).toEqual({ code: 'tablet_windows_span_too_long', row: null })
    expect(noLockWindowsError([w(300, 840), w(860, 1440)], limited)).toEqual({ code: 'tablet_windows_span_too_long', row: null })
    expect(noLockWindowsError([w(360, 480), w(900, 1200)], limited)).toBeNull()
    expect(noLockWindowsError([w(0, 840), w(840, 1440)])).toBeNull()
  })

  it('sorts the windows by start', () => {
    expect(sortedWindows([w(900, 960), w(420, 480)])).toEqual([w(420, 480), w(900, 960)])
  })
})

describe('windowsOnDay', () => {
  it('cuts the windows to the opening hours, dropping those outside', () => {
    expect(windowsOnDay([w(0, 1440)], w(420, 990))).toEqual([w(420, 990)])
    expect(windowsOnDay([w(400, 480), w(960, 1020), w(1000, 1100)], w(420, 990))).toEqual([w(420, 480), w(960, 990)])
  })

  it('without opening hours that day cuts everything to 14 hours after the earliest start', () => {
    expect(windowsOnDay([w(0, 1440)], null)).toEqual([w(0, 840)])
    expect(windowsOnDay([w(0, 840), w(840, 1440)], null)).toEqual([w(0, 840)])
    // A nearly touching chain (gap shorter than the lock time) ends 14 hours after 5:00 too.
    expect(windowsOnDay([w(300, 840), w(860, 1440)], null)).toEqual([w(300, 840), w(860, 1140)])
    expect(windowsOnDay([w(420, 480), w(900, 960)], null)).toEqual([w(420, 480), w(900, 960)])
    expect(windowsOnDay([], null)).toEqual([])
  })
})

describe('noLockPeriods', () => {
  it('gives the moments of the windows of one day, touching windows joined', () => {
    expect(noLockPeriods([w(900, 960), w(420, 480)], day)).toEqual([
      { from: berlin(420), until: berlin(480) }, { from: berlin(900), until: berlin(960) },
    ])
    expect(noLockPeriods([w(420, 480), w(480, 510)], day)).toEqual([{ from: berlin(420), until: berlin(510) }])
    expect(noLockPeriods([], day)).toEqual([])
  })
})

describe('unlockDeadline (expiry with windows)', () => {
  const lock = 2 * MIN
  // Window 7:30–8:00 and 15:00–16:00.
  const periods: NoLockPeriod[] = noLockPeriods([w(450, 480), w(900, 960)], day)

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

  it('chains windows of the same day the unlock reaches alive', () => {
    const close = noLockPeriods([w(450, 480), w(481, 500)], day)
    expect(unlockDeadline(berlin(455), lock, close)).toBe(berlin(502))
  })

  it('never carries over midnight: a window of the next day does not extend the unlock', () => {
    const lateAndEarly = [...noLockPeriods([w(1380, 1440)], day), ...noLockPeriods([w(0, 60)], next)]
    // Used 23:30 inside 23:00–24:00: ends 0:02 although 0:00–1:00 of the next day starts within the lock time.
    expect(unlockDeadline(berlin(1410), lock, lateAndEarly)).toBe(berlin(2, next))
    // A touch after midnight makes the new day's window apply.
    expect(unlockDeadline(berlin(1, next), lock, lateAndEarly)).toBe(berlin(62, next))
  })
})

describe('noLockUntil', () => {
  const periods = noLockPeriods([w(450, 480)], day)
  it('is the end of the window the moment lies in, else null', () => {
    expect(noLockUntil(berlin(450), periods)).toBe(berlin(480))
    expect(noLockUntil(berlin(479), periods)).toBe(berlin(480))
    expect(noLockUntil(berlin(480), periods)).toBeNull()
    expect(noLockUntil(berlin(449), periods)).toBeNull()
  })
})
