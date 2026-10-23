import { formatTime, parseTime } from '#shared/domain/time'

/** A stored time as the settings forms show it ('' for none). */
export const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))

/** Empty = no time; undefined = typed but not a valid time. */
export const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

/**
 * A typed time for comparing a form with the stored value: the minutes (null when empty), or the text itself while it is
 * not a valid time (so it always counts as a change).
 */
export function timeKey(value: string): number | null | string {
  const minutes = optionalTime(value)
  return minutes === undefined ? `?${value}` : minutes
}
