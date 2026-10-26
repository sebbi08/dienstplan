import type { IsoDate } from '#shared/domain/types'

/** Dates typed as TT.MM.JJJJ: formatting, parsing and the automatic dots while typing. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const TEXT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** '2021-05-03' → '03.05.2021'; anything else → ''. */
export function formatDateText(iso: string | null | undefined): string {
  const match = ISO.exec(iso ?? '')
  if (!match) return ''
  const [, year, month, day] = match
  if (!isRealDate(Number(year), Number(month), Number(day))) return ''
  return `${day}.${month}.${year}`
}

/** '3.5.2021' or '03.05.2021' → '2021-05-03'; incomplete, impossible or two-digit years → null. */
export function parseDateText(text: string): IsoDate | null {
  const match = TEXT.exec(text.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (year < 1000 || !isRealDate(year, month, day)) return null
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** `next` came from `previous` by removing characters only (not by typing or pasting over a selection). */
function isDeletion(previous: string, next: string): boolean {
  let index = 0
  for (const char of previous) {
    if (char === next[index]) index++
  }
  return index === next.length
}

/**
 * The text after a keystroke. Deleting keeps the text as it is; typing puts the digits into TT.MM.JJJJ and adds
 * the dots by itself (a dot typed by hand ends the day or month early, e.g. „3.5.2021“).
 */
export function autoDots(previous: string, next: string): string {
  if (next.length < previous.length && isDeletion(previous, next)) return next
  const parts = ['', '', '']
  let part = 0
  let out = ''
  for (const char of next) {
    if (char >= '0' && char <= '9') {
      if (part === 2 && parts[2]!.length >= 4) break
      parts[part] += char
      out += char
      if (part < 2 && parts[part]!.length === 2) {
        out += '.'
        part++
      }
    }
    else if (char === '.' && part < 2 && parts[part] !== '') {
      out += '.'
      part++
    }
  }
  return out
}
