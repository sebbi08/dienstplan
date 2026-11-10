import { parseTime } from '#shared/domain/time'
import { shiftBreakCheck } from '#shared/domain/timeRecords'

export interface WorkTimeInput { start: string; end: string; breakStart: string; breakEnd: string }

/** Empty = no time; undefined = typed but not a valid time. */
const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

/**
 * Presence, working time and the legal break (§ 4 ArbZG, via shiftBreakCheck) of the times typed so far, in minutes;
 * null while start/end are missing or unreadable, end is not after start, or the break is unreadable or half filled.
 */
export function workTime(input: WorkTimeInput): { present: number; worked: number; required: number; ok: boolean } | null {
  const start = parseTime(input.start)
  const end = parseTime(input.end)
  const breakStart = optionalTime(input.breakStart)
  const breakEnd = optionalTime(input.breakEnd)
  if (start === null || end === null || end <= start || breakStart === undefined || breakEnd === undefined) return null
  if ((breakStart === null) !== (breakEnd === null)) return null
  const check = shiftBreakCheck({ start, end, breakStart, breakEnd })
  return { present: end - start, ...check }
}
