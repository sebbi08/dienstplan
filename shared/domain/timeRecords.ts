import type { IsoDate, Minutes } from './types'

/** A clocked period of one day; end null = still clocked in. */
export interface RecordSpan {
  start: Minutes
  end: Minutes | null
}

function closed(records: RecordSpan[]): { start: Minutes; end: Minutes }[] {
  return records
    .filter((record): record is { start: Minutes; end: Minutes } => record.end !== null)
    .sort((a, b) => a.start - b.start)
}

/** Worked minutes of one day: the sum of its closed records (gaps are breaks, open records count 0). */
export function recordedMinutes(records: RecordSpan[]): number {
  return closed(records).reduce((sum, record) => sum + (record.end - record.start), 0)
}

/** Only interruptions of at least 15 minutes count as legal break parts (§ 4 ArbZG). */
export const BREAK_MIN_GAP = 15

export function breakMinutes(records: RecordSpan[]): number {
  const sorted = closed(records)
  let total = 0
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index]!.start - sorted[index - 1]!.end
    if (gap >= BREAK_MIN_GAP) total += gap
  }
  return total
}

/** More than 6 h needs 30 min break, more than 9 h needs 45 min. Only a hint; nothing is deducted. */
export function breakRuleViolated(records: RecordSpan[]): boolean {
  const worked = recordedMinutes(records)
  const required = worked > 9 * 60 ? 45 : worked > 6 * 60 ? 30 : 0
  return breakMinutes(records) < required
}

const berlinClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Current date and minute of the day in Europe/Berlin (stamps never use the device clock). */
export function nowInBerlin(now: Date): { date: IsoDate; minutes: Minutes } {
  const parts = Object.fromEntries(berlinClock.formatToParts(now).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}
