import type { IsoDate, Minutes } from './types'

/** Minutes without use after which a facility's tablet locks the child records again (the default and the allowed range). */
export const DEFAULT_TABLET_LOCK_MINUTES = 2
export const MIN_TABLET_LOCK_MINUTES = 1
export const MAX_TABLET_LOCK_MINUTES = 30

/**
 * While a person edits the plan at the tablet („Dienstplan bearbeiten“, with their own account's rights) the lock time
 * is at most this long, whatever the facility set (and the windows without the automatic lock do not apply).
 */
export const PLAN_EDIT_MAX_LOCK_MINUTES = 5

/**
 * However much it is used, editing the plan at the tablet ends this long after it started: the person unlocks with the
 * PIN again and taps „Dienstplan bearbeiten“ once more. Bounds an editing unlock someone else keeps using.
 */
export const PLAN_EDIT_MAX_MINUTES = 60

/** The moment (ms) an editing session started at `planEditSince` (ISO) ends at the latest (PLAN_EDIT_MAX_MINUTES). */
export function planEditEndsAt(planEditSince: string): number {
  return Date.parse(planEditSince) + PLAN_EDIT_MAX_MINUTES * 60_000
}

/**
 * The query flag (`?editor=1`) with which the plan editor's view at the tablet asks for the month plan as the editing
 * person; without it the tablet always reads the released plan (server/utils/auth.ts planReader).
 */
export const PLAN_EDITOR_QUERY = 'editor'

/** The lock time of an unlock: the facility's, shortened to PLAN_EDIT_MAX_LOCK_MINUTES while the plan is edited. */
export function unlockLockMinutes(lockMinutes: number, editingPlan: boolean): number {
  return editingPlan ? Math.min(lockMinutes, PLAN_EDIT_MAX_LOCK_MINUTES) : lockMinutes
}

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
 * Without opening hours for every weekday the windows of a day may span at most this long, from the earliest start to
 * the latest end (so neither 0:00–24:00 nor touching or nearly touching windows can switch the lock off for the day);
 * with them, every window is cut to the day's opening hours anyway.
 */
export const MAX_UNBOUNDED_WINDOW_MINUTES = 14 * 60

/**
 * A time window „Keine automatische Sperre“ (minutes after midnight, Berlin time; start 0:00–23:59, end after the start,
 * at most 24:00). It applies on every day the facility is open, within that day's opening hours.
 */
export interface TimeWindow { start: Minutes; end: Minutes }

export type NoLockWindowErrorCode =
  | 'tablet_windows_too_many' | 'tablet_window_time_invalid' | 'tablet_window_invalid' | 'tablet_windows_overlap'
  | 'tablet_window_too_long' | 'tablet_windows_span_too_long'

/**
 * The settings check of the windows (null = fine): at most MAX_NO_LOCK_WINDOWS, each from a minute of the day to a later
 * one (24:00 at most), none overlapping another (touching is fine). `limitLength` (the facility has no opening hours for
 * every weekday): none longer than MAX_UNBOUNDED_WINDOW_MINUTES, and all together not spanning more than that from the
 * earliest start to the latest end. `row` (1-based, input order) names the wrong window; of two overlapping ones the
 * later in the list; none for the span.
 */
export function noLockWindowsError(
  windows: readonly TimeWindow[], options: { limitLength?: boolean } = {},
): { code: NoLockWindowErrorCode; row: number | null } | null {
  if (windows.length > MAX_NO_LOCK_WINDOWS) return { code: 'tablet_windows_too_many', row: null }
  const minute = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max
  for (const [index, window] of windows.entries()) {
    if (!minute(window.start, DAY_MINUTES - 1) || !minute(window.end, DAY_MINUTES)) return { code: 'tablet_window_time_invalid', row: index + 1 }
    if (window.end <= window.start) return { code: 'tablet_window_invalid', row: index + 1 }
    if (options.limitLength && window.end - window.start > MAX_UNBOUNDED_WINDOW_MINUTES) return { code: 'tablet_window_too_long', row: index + 1 }
  }
  for (let later = 1; later < windows.length; later++) {
    const b = windows[later]!
    if (windows.slice(0, later).some(a => a.start < b.end && b.start < a.end)) return { code: 'tablet_windows_overlap', row: later + 1 }
  }
  if (options.limitLength && windows.length > 0
    && Math.max(...windows.map(window => window.end)) - Math.min(...windows.map(window => window.start)) > MAX_UNBOUNDED_WINDOW_MINUTES) {
    return { code: 'tablet_windows_span_too_long', row: null }
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
 * The windows as they apply on one open day: cut to the day's opening hours when they are entered (a window outside
 * them falls away); without opening hours that day, cut to MAX_UNBOUNDED_WINDOW_MINUTES after the earliest start (the
 * settings refuse a longer span, but opening hours may have been removed since).
 */
export function windowsOnDay(windows: readonly TimeWindow[], hours: TimeWindow | null): TimeWindow[] {
  const bounds = hours ?? (windows.length === 0 ? null
    : { start: 0, end: Math.min(...windows.map(window => window.start)) + MAX_UNBOUNDED_WINDOW_MINUTES })
  if (bounds === null) return []
  return windows.map(window => ({ start: Math.max(window.start, bounds.start), end: Math.min(window.end, bounds.end) }))
    .filter(window => window.end > window.start)
}

/**
 * The stretches of the windows on one day (an open day of the facility; windows as windowsOnDay gives them): touching
 * windows are joined, never across midnight.
 */
export function noLockPeriods(windows: readonly TimeWindow[], date: IsoDate): NoLockPeriod[] {
  const periods: NoLockPeriod[] = []
  for (const window of sortedWindows(windows)) {
    const from = berlinInstant(date, window.start)
    const until = berlinInstant(date, window.end)
    const last = periods.at(-1)
    if (last && from <= last.until) last.until = Math.max(last.until, until)
    else periods.push({ from, until })
  }
  return periods
}

/** The Berlin date of a moment. */
export function berlinDate(moment: number): IsoDate {
  const parts = Object.fromEntries(berlinParts.formatToParts(new Date(moment)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/**
 * The moment after which an unlock last used at `lastUse` runs out: last use plus the lock time; but a window of the
 * same (Berlin) day the unlock lies in, or reaches before running out, keeps it open to the window's end, and from there
 * the lock time counts again (max(last use, window end) + lock time). A window that starts after the unlock ran out
 * does not revive it, and a window of a later day never extends it (nothing carries over midnight).
 */
export function unlockDeadline(lastUse: number, lockMs: number, periods: readonly NoLockPeriod[]): number {
  const day = berlinDate(lastUse)
  const dayStart = berlinInstant(day, 0)
  const dayEnd = berlinInstant(day, DAY_MINUTES)
  let deadline = lastUse + lockMs
  for (const period of periods) {
    if (period.from < dayStart || period.until > dayEnd || period.until <= lastUse) continue
    if (period.from > deadline) break
    deadline = Math.max(deadline, period.until + lockMs)
  }
  return deadline
}

/** The end of the window the moment lies in (null outside every window). */
export function noLockUntil(moment: number, periods: readonly NoLockPeriod[]): number | null {
  return periods.find(period => period.from <= moment && moment < period.until)?.until ?? null
}
