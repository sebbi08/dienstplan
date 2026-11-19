import type { IsoDate, Minutes } from './types'

/** Minutes without use after which a facility's tablet locks the child records again (the default and the allowed range). */
export const DEFAULT_TABLET_LOCK_MINUTES = 2
export const MIN_TABLET_LOCK_MINUTES = 1
export const MAX_TABLET_LOCK_MINUTES = 30

/** The server accepts an unlock this long after the lock time ran out, so a keep-alive on its way is not refused. */
export const UNLOCK_GRACE_SECONDS = 30

/** After an interaction the tablet sends a keep-alive at most this often. */
export const KEEP_ALIVE_MIN_SECONDS = 15

/** While unlocked, the tablet asks this often whether the server still counts it as unlocked (the status changes nothing). */
export const STATUS_POLL_SECONDS = 30

/** At most this many time windows „Keine automatische Sperre“ per facility. */
export const MAX_NO_LOCK_WINDOWS = 6

const DAY_MINUTES = 1440

/**
 * A time window „Keine automatische Sperre“ (minutes after midnight, Berlin time; start 0:00–23:59, end after the start,
 * at most 24:00). It applies on every day the facility is open.
 */
export interface TimeWindow { start: Minutes; end: Minutes }

export type NoLockWindowErrorCode = 'tablet_windows_too_many' | 'invalid_time' | 'tablet_window_invalid' | 'tablet_windows_overlap'

/**
 * The settings check of the windows (null = fine): at most MAX_NO_LOCK_WINDOWS, each from a minute of the day to a later
 * one (24:00 at most), none overlapping another (touching is fine: they count as one). `row` (1-based, input order)
 * names the wrong window; of two overlapping ones the later in the list.
 */
export function noLockWindowsError(windows: readonly TimeWindow[]): { code: NoLockWindowErrorCode; row: number | null } | null {
  if (windows.length > MAX_NO_LOCK_WINDOWS) return { code: 'tablet_windows_too_many', row: null }
  const minute = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max
  for (const [index, window] of windows.entries()) {
    if (!minute(window.start, DAY_MINUTES - 1) || !minute(window.end, DAY_MINUTES)) return { code: 'invalid_time', row: index + 1 }
    if (window.end <= window.start) return { code: 'tablet_window_invalid', row: index + 1 }
  }
  for (let later = 1; later < windows.length; later++) {
    const b = windows[later]!
    if (windows.slice(0, later).some(a => a.start < b.end && b.start < a.end)) return { code: 'tablet_windows_overlap', row: later + 1 }
  }
  return null
}

/** The windows by start. */
export function sortedWindows(windows: readonly TimeWindow[]): TimeWindow[] {
  return [...windows].sort((a, b) => a.start - b.start || a.end - b.end)
}

const berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** How far Berlin's clock is ahead of UTC at a moment (ms). */
function berlinOffset(moment: number): number {
  const parts = Object.fromEntries(berlinParts.formatToParts(new Date(moment)).map(part => [part.type, Number(part.value)]))
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!)
  return wall - Math.floor(moment / 60_000) * 60_000
}

/** The moment (ms since 1970) of a Berlin wall clock time; 1440 minutes = midnight at the end of the day. */
export function berlinInstant(date: IsoDate, minutes: Minutes): number {
  const [year, month, day] = date.split('-').map(Number)
  const wall = Date.UTC(year!, month! - 1, day!) + minutes * 60_000
  // Twice: the offset of the first guess may be the other side of a summer time change.
  return wall - berlinOffset(wall - berlinOffset(wall))
}

/** A stretch of time (ms since 1970, `until` excluded) in which an unlock does not run out by inactivity. */
export interface NoLockPeriod { from: number; until: number }

/**
 * The stretches of the windows on the given days (the facility's open days, ascending): touching windows, also 24:00
 * and 0:00 of the next day, are joined into one.
 */
export function noLockPeriods(windows: readonly TimeWindow[], dates: readonly IsoDate[]): NoLockPeriod[] {
  const periods: NoLockPeriod[] = []
  const sorted = sortedWindows(windows)
  for (const date of dates) {
    for (const window of sorted) {
      const from = berlinInstant(date, window.start)
      const until = berlinInstant(date, window.end)
      const last = periods.at(-1)
      if (last && from <= last.until) last.until = Math.max(last.until, until)
      else periods.push({ from, until })
    }
  }
  return periods
}

/**
 * The moment after which an unlock last used at `lastUse` runs out: last use plus the lock time; but a window the unlock
 * lies in, or reaches before running out, keeps it open to the window's end, and from there the lock time counts again
 * (max(last use, window end) + lock time). A window that starts after the unlock ran out does not revive it.
 */
export function unlockDeadline(lastUse: number, lockMs: number, periods: readonly NoLockPeriod[]): number {
  let deadline = lastUse + lockMs
  for (const period of periods) {
    if (period.until <= lastUse) continue
    if (period.from > deadline) break
    deadline = Math.max(deadline, period.until + lockMs)
  }
  return deadline
}

/** The end of the window the moment lies in (null outside every window). */
export function noLockUntil(moment: number, periods: readonly NoLockPeriod[]): number | null {
  return periods.find(period => period.from <= moment && moment < period.until)?.until ?? null
}
