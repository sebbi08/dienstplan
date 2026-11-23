import { performance } from 'node:perf_hooks'
import { constants, inflateSync } from 'node:zlib'

/**
 * Whether a PDF is a form to fill in the app („Ausfüllen“, „Weiter ausfüllen“): it has an interactive form (/AcroForm)
 * with at least one field to type in or tick (field type text, button or choice; a signature field alone does not
 * count). Judged from the bytes without a PDF library, once when the file is stored (the result is a column): the
 * plain part of the file and every compressed object stream (where PDF 1.5 and newer often keep the catalog and the
 * fields). The bytes come from uploads, so the scan is linear (searches with indexOf, only bounded patterns on short
 * slices) and stops at fixed limits — too much to inflate, too many object streams, too much time — with „not
 * fillable“. A file it cannot read (e.g. encrypted object streams) counts as not fillable as well; the fill view checks
 * again with pdf.js when it opens.
 */

export interface ScanLimits {
  /** Largest inflated object stream (form object streams are a few KB). */
  perStream: number
  /** All inflated object streams of the file together. */
  total: number
  /** Object streams looked at. */
  maxStreams: number
  /** Wall-clock time for the whole scan, in milliseconds. */
  budgetMs: number
}

/**
 * Tuned for uploads up to 30 MB: a benign 25 MB PDF (a form plus a large image) scans in about 25–55 ms, so 500 ms leaves
 * room for slow hardware; object streams that hold forms are a few KB, so 4 MB each and 64 MB together (inflated one at
 * a time, never held together) stay bounded however large the file.
 */
export const SCAN_LIMITS: ScanLimits = { perStream: 4 * 1024 * 1024, total: 64 * 1024 * 1024, maxStreams: 1000, budgetMs: 500 }

/** How far the dictionary of an object stream may reach before and after its /Type entry. */
const DICTIONARY_REACH = 4096

/** A byte that ends a PDF name (white space or a delimiter), or the end of the data. */
function endsName(data: Uint8Array, index: number): boolean {
  if (index >= data.length) return true
  const byte = data[index]!
  // NUL, tab, LF, FF, CR, space, ( ) < > [ ] { } / %
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32 || byte === 40 || byte === 41
    || byte === 60 || byte === 62 || byte === 91 || byte === 93 || byte === 123 || byte === 125 || byte === 47 || byte === 37
}

const isSpace = (byte: number | undefined) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32

/** Whether the name `name` (with its slash) occurs as a whole name. */
function hasName(data: Buffer, name: string, check: () => void): boolean {
  let count = 0
  for (let at = data.indexOf(name, 0, 'latin1'); at !== -1; at = data.indexOf(name, at + 1, 'latin1')) {
    if (++count % 4096 === 0) check()
    if (endsName(data, at + name.length)) return true
  }
  return false
}

const FIELD_TYPES = ['/Tx', '/Btn', '/Ch']

/** Whether a field type to fill (/FT /Tx, /FT /Btn, /FT /Ch) occurs. */
function hasFieldType(data: Buffer, check: () => void): boolean {
  let count = 0
  for (let at = data.indexOf('/FT', 0, 'latin1'); at !== -1; at = data.indexOf('/FT', at + 1, 'latin1')) {
    if (++count % 4096 === 0) check()
    let index = at + 3
    // At most a few white-space bytes between the key and its value.
    for (let skipped = 0; skipped < 8 && isSpace(data[index]); skipped++) index++
    for (const type of FIELD_TYPES) {
      if (data.toString('latin1', index, index + type.length) === type && endsName(data, index + type.length)) return true
    }
  }
  return false
}

class LimitReached extends Error {}

/** The decoded bytes of a FlateDecode stream within the limits; null when it cannot be decoded. */
function inflate(raw: Buffer, maxOutputLength: number): Buffer | null {
  try {
    return inflateSync(raw, { maxOutputLength })
  }
  catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ERR_BUFFER_TOO_LARGE') throw new LimitReached()
    // A stream cut short (or with trailing bytes): once more without insisting on its end. Nothing else is retried.
    if (code !== 'Z_BUF_ERROR') return null
    try {
      return inflateSync(raw, { maxOutputLength, finishFlush: constants.Z_SYNC_FLUSH })
    }
    catch (retryError) {
      if ((retryError as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new LimitReached()
      return null
    }
  }
}

/** The end of the stream data starting at `start`: the direct /Length when it fits, else the next `endstream`. */
function streamEnd(data: Buffer, dictionary: string, start: number): number {
  const length = /\/Length[ \t\r\n]{0,8}(\d{1,10})([ \t\r\n]{1,8}\d{1,5}[ \t\r\n]{1,8}R)?/.exec(dictionary)
  if (length && !length[2]) {
    const end = start + Number(length[1])
    if (end <= data.length) return end
  }
  // An indirect length (`12 0 R`) or one that does not fit: up to the keyword.
  const keyword = data.indexOf('endstream', start, 'latin1')
  return keyword === -1 ? data.length : keyword
}

export function hasFormFields(data: Buffer, limits: ScanLimits = SCAN_LIMITS): boolean {
  if (data.toString('latin1', 0, 5) !== '%PDF-') return false
  const started = performance.now()
  const overTime = () => performance.now() - started > limits.budgetMs
  const check = () => {
    if (overTime()) throw new LimitReached()
  }
  let streams = 0
  let inflated = 0
  // The last `obj` before and the next `stream` after the current hit, found by searches that only move forward (so
  // many hits never rescan the same bytes).
  let lastObj = -1
  let upcomingObj = data.indexOf('obj', 0, 'latin1')
  let upcomingStream = data.indexOf('stream', 0, 'latin1')
  // Steps of those searches, for the time check.
  let steps = 0
  try {
    let acroForm = hasName(data, '/AcroForm', check)
    let field = hasFieldType(data, check)
    if (acroForm && field) return true
    for (let at = data.indexOf('/ObjStm', 0, 'latin1'); at !== -1; at = data.indexOf('/ObjStm', at + 1, 'latin1')) {
      if (overTime()) return false
      if (!endsName(data, at + 7)) continue
      // The dictionary: from its object's `obj` (at most DICTIONARY_REACH back) to its `stream` keyword (as far ahead).
      while (upcomingObj !== -1 && upcomingObj < at) {
        lastObj = upcomingObj
        upcomingObj = data.indexOf('obj', upcomingObj + 1, 'latin1')
        if (++steps % 4096 === 0) check()
      }
      while (upcomingStream !== -1 && upcomingStream < at) {
        upcomingStream = data.indexOf('stream', upcomingStream + 1, 'latin1')
        if (++steps % 4096 === 0) check()
      }
      if (lastObj === -1 || at - lastObj > DICTIONARY_REACH || upcomingStream === -1 || upcomingStream - at > DICTIONARY_REACH) continue
      const objectStart = lastObj
      const keyword = upcomingStream
      const dictionary = data.toString('latin1', objectStart, keyword)
      if (!/\/Type[ \t\r\n]{0,8}\/ObjStm/.test(dictionary)) continue
      let start = keyword + 6
      if (data[start] === 13) start++
      if (data[start] === 10) start++
      const end = streamEnd(data, dictionary, start)
      if (++streams > limits.maxStreams) return false
      const raw = data.subarray(start, end)
      let content: Buffer | null
      if (!dictionary.includes('/Filter')) content = raw
      else if (/\/Filter[ \t\r\n]{0,8}(\[[ \t\r\n]{0,8})?\/FlateDecode/.test(dictionary)) {
        content = inflate(raw, Math.min(limits.perStream, limits.total - inflated))
      }
      else content = null
      if (content === null) continue
      inflated += content === raw ? 0 : content.length
      if (inflated >= limits.total) return false
      acroForm ||= hasName(content, '/AcroForm', check)
      field ||= hasFieldType(content, check)
      if (acroForm && field) return true
      // Past this stream's data: nothing inside it is a dictionary of the file.
      at = Math.max(at, end - 1)
    }
  }
  catch (error) {
    if (error instanceof LimitReached) return false
    throw error
  }
  return false
}

/** For a file being stored: a PDF is judged, anything else is no form. Never throws. */
export function fillableFile(data: Buffer, mimeType: string): boolean {
  if (mimeType !== 'application/pdf') return false
  try {
    return hasFormFields(data)
  }
  catch {
    return false
  }
}
