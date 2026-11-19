import { parseTime, type SpanError, type TimeSpan, validateSpan } from './time'

/** Why a typed time span is refused: nothing typed, not „von-bis“, a clock time that does not exist, or a span error. */
export type QuickTimeError = 'empty' | 'format' | 'invalid_time' | Exclude<SpanError, 'incomplete_break'>

/** A clock time as parseTime takes it: "7", "730", "0730", "7:30", "7.30", "7,30". */
const TIME = String.raw`(\d{1,2}(?:[:.,]?\d{2})?)`
/** Between two times: "-", "–", "—", the minus sign "−" (U+2212, e.g. from a phone keyboard) or „bis“, with or without spaces. */
const DASH = String.raw`\s*(?:-|–|—|−|bis)\s*`
/** „von-bis“, optionally followed by „P“ or „Pause“ and the break's „von-bis“ ("7:30-14 P 11:30-12"). */
const QUICK_TIME = new RegExp(String.raw`^${TIME}${DASH}${TIME}(?:\s*[,;]?\s*(?:pause|p)\.?\s*:?\s*${TIME}${DASH}${TIME})?$`, 'i')

/**
 * A special shift's times typed into a plan or template cell: „7:30-14:00“, „730-14“, „7.30–14“, „7 bis 14“, with an
 * optional break „P 11:30-12:00“ / „Pause 11:30-12“. Checked like the „Sonderdienst“ dialog (TimeInput, validateSpan):
 * the 5-minute grid, the end after the start and the break inside the shift.
 */
export function parseQuickTime(text: string): { span: TimeSpan } | { error: QuickTimeError } {
  const trimmed = text.trim()
  if (!trimmed) return { error: 'empty' }
  const match = QUICK_TIME.exec(trimmed)
  if (!match) return { error: 'format' }
  // A break left out is undefined; a typed time that does not exist (7:75, 25) is null.
  const [start, end, breakStart, breakEnd] = match.slice(1, 5).map(value => (value === undefined ? undefined : parseTime(value)))
  if ([start, end, breakStart, breakEnd].includes(null)) return { error: 'invalid_time' }
  const span: TimeSpan = { start: start!, end: end!, breakStart: breakStart ?? null, breakEnd: breakEnd ?? null }
  const error = validateSpan(span)
  // Both break times are typed or none (the pattern), so validateSpan never finds an incomplete break.
  if (error && error !== 'incomplete_break') return { error }
  return { span }
}
