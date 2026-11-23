import { constants, inflateSync } from 'node:zlib'

/**
 * Whether a PDF is a form to fill in the app („Ausfüllen“, „Weiter ausfüllen“): it has an interactive form (/AcroForm)
 * with at least one field to type in or tick (field type text, button or choice; a signature field alone does not
 * count). Judged from the bytes without a PDF library: the plain part of the file and every compressed object stream
 * (where PDF 1.5 and newer often keep the catalog and the fields). A file it cannot read (e.g. encrypted object
 * streams) counts as not fillable; the fill view checks again with pdf.js when it opens.
 */

const FIELD_TYPE = /\/FT\s*\/(?:Tx|Btn|Ch)(?=[\s/<>[\]()%]|$)/
const ACRO_FORM = /\/AcroForm(?=[\s/<>[\]()%]|$)/
/** An object's dictionary up to its `stream` keyword (not past its `endobj`). */
const STREAM_OBJECT = /\d+\s+\d+\s+obj\b((?:(?!endobj)[\s\S]){0,4096}?)stream(?:\r\n|\n|\r)/g
/** More is not a form's object stream (and stops a „zip bomb“). */
const MAX_INFLATED = 32 * 1024 * 1024

/** The decoded content of the object stream starting at `start`, or null when it cannot be decoded. */
function objectStream(data: Buffer, text: string, dictionary: string, start: number): string | null {
  const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)
  const end = length ? Math.min(data.length, start + Number(length[1])) : text.indexOf('endstream', start)
  if (end < start) return null
  const raw = data.subarray(start, end)
  if (!/\/Filter/.test(dictionary)) return raw.toString('latin1')
  if (!/\/Filter\s*(?:\[\s*)?\/FlateDecode\s*\]?/.test(dictionary)) return null
  for (const finishFlush of [constants.Z_FINISH, constants.Z_SYNC_FLUSH]) {
    try {
      return inflateSync(raw, { maxOutputLength: MAX_INFLATED, finishFlush }).toString('latin1')
    }
    catch {
      // A stream cut short or with trailing bytes: tried once more without insisting on its end.
    }
  }
  return null
}

export function hasFormFields(data: Buffer): boolean {
  const text = data.toString('latin1')
  if (!text.startsWith('%PDF-')) return false
  let acroForm = ACRO_FORM.test(text)
  let field = FIELD_TYPE.test(text)
  if (acroForm && field) return true
  STREAM_OBJECT.lastIndex = 0
  for (let match = STREAM_OBJECT.exec(text); match; match = STREAM_OBJECT.exec(text)) {
    const dictionary = match[1]!
    if (!/\/Type\s*\/ObjStm/.test(dictionary)) continue
    const content = objectStream(data, text, dictionary, match.index + match[0].length)
    if (content === null) continue
    acroForm ||= ACRO_FORM.test(content)
    field ||= FIELD_TYPE.test(content)
    if (acroForm && field) return true
  }
  return false
}

/**
 * The answers per stored file, so a list reads each file's bytes once per server run: keyed by table and id, valid as
 * long as the stamp (e.g. the upload time and size) is the same. A replaced file gets a new stamp; its write forgets the
 * old answer as well.
 */
const answers = new Map<string, { stamp: string; fillable: boolean }>()
const MAX_ANSWERS = 5000

export function cachedHasFormFields(table: string, id: number, stamp: string, load: () => Buffer): boolean {
  const key = `${table}:${id}`
  const known = answers.get(key)
  if (known && known.stamp === stamp) return known.fillable
  const fillable = hasFormFields(load())
  answers.delete(key)
  if (answers.size >= MAX_ANSWERS) answers.delete(answers.keys().next().value!)
  answers.set(key, { stamp, fillable })
  return fillable
}

export function forgetFormFields(table: string, id: number): void {
  answers.delete(`${table}:${id}`)
}
