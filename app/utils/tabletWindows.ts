// The texts are imported relative so a test can load this file.
import { noLockUntil, noLockWindowsError, type NoLockPeriod, type TimeWindow } from '#shared/domain/tablet'
import { formatTime, parseTime } from '#shared/domain/time'
import { nowInBerlin } from '#shared/domain/timeRecords'
import type { NoLockPeriodDto } from '#shared/types/api'
import { de } from '../locales/de'

/** One window „Keine automatische Sperre“ as the settings form edits it (typed times). */
export interface WindowDraft { start: string; end: string }

export function toWindowDrafts(windows: readonly TimeWindow[]): WindowDraft[] {
  return windows.map(window => ({ start: formatTime(window.start), end: formatTime(window.end) }))
}

/** The drafts stand for the same windows (typed differently, e.g. "7:30" and "730", counts as the same). */
export function sameWindowDrafts(left: readonly WindowDraft[], right: readonly WindowDraft[]): boolean {
  const key = (value: string) => parseTime(value) ?? value.trim()
  return left.length === right.length
    && left.every((draft, index) => key(draft.start) === key(right[index]!.start) && key(draft.end) === key(right[index]!.end))
}

/**
 * The windows to save, or the problem with the row (1-based) to mark: an unreadable or empty time, „Bis“ not after
 * „Von“, more than six, overlapping (the server's check, here first).
 */
export function fromWindowDrafts(drafts: readonly WindowDraft[]):
  { windows: TimeWindow[]; problem: null } | { windows: null; problem: { row: number | null; text: string } } {
  const windows: TimeWindow[] = []
  for (const [index, draft] of drafts.entries()) {
    const start = parseTime(draft.start)
    const end = parseTime(draft.end)
    if (start === null || end === null) return { windows: null, problem: { row: index + 1, text: de.errors.tablet_window_time_invalid } }
    windows.push({ start, end })
  }
  const refused = noLockWindowsError(windows)
  return refused ? { windows: null, problem: { row: refused.row, text: de.errors[refused.code] } } : { windows, problem: null }
}

/** The stretches of the status as moments. */
export function toNoLockPeriods(periods: readonly NoLockPeriodDto[]): NoLockPeriod[] {
  return periods.map(period => ({ from: Date.parse(period.from), until: Date.parse(period.until) }))
}

/** The end of a window as Berlin clock time like the rest of the app („8:30“); midnight is „24:00“. */
function endTime(moment: number): string {
  const { minutes } = nowInBerlin(new Date(moment))
  return formatTime(minutes === 0 ? 1440 : minutes)
}

/** The unlock bar's note while a window without the automatic lock runs („ohne automatische Sperre bis 8:30“), else null. */
export function noAutoLockNote(periods: readonly NoLockPeriod[], now: number): string | null {
  const until = noLockUntil(now, periods)
  return until === null ? null : de.terminal.noAutoLockUntil(endTime(until))
}
