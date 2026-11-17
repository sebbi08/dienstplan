/**
 * The birthday as one typed field: „TT.MM.“ (day and month only) or „TT.MM.JJJJ“ (with the birth year, for viewers of
 * the personnel file). Leading zeros and the last dot are optional; an empty field means no birthday.
 */
export type BirthdayParse = { ok: true, birthday: string | null, year: number | null } | { ok: false }

const TEXT = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4})?)?$/
const MIN_YEAR = 1900

const daysIn = (month: number, year: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * `birthday` is MM-DD (29 February allowed without a year), `year` the birth year or null. With `withYear` false a
 * typed year is refused. The year must lie between 1900 and `currentYear` and form a real date with day and month.
 */
export function parseBirthday(text: string, withYear: boolean, currentYear: number): BirthdayParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, birthday: null, year: null }
  const match = TEXT.exec(trimmed)
  if (!match) return { ok: false }
  const day = Number(match[1])
  const month = Number(match[2])
  const year = match[3] === undefined ? null : Number(match[3])
  if (month < 1 || month > 12 || day < 1) return { ok: false }
  if (year === null) {
    if (day > daysIn(month, 2000)) return { ok: false }
  }
  else {
    if (!withYear || year < MIN_YEAR || year > currentYear || day > daysIn(month, year)) return { ok: false }
  }
  return { ok: true, birthday: `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year }
}

/** MM-DD (and the year, where it may be shown) as typed text; empty without a birthday. */
export function formatBirthday(birthday: string | null, year: number | null, withYear: boolean): string {
  if (!birthday) return ''
  const [month, day] = birthday.split('-')
  return `${day}.${month}.${withYear && year !== null ? year : ''}`
}
