/**
 * Schulbezirke: the street lists of a city that say which primary school district a house number belongs to, read from
 * a PDF text layer or a CSV file, and matched against a child's address. Pure functions, used by the server (parse,
 * save, match) and the settings page (preview, overlaps, CSV download).
 */

/** Which house numbers of the range count: the odd ones, the even ones, or all. */
export const DISTRICT_SIDES = ['odd', 'even', 'all'] as const
export type DistrictSide = typeof DISTRICT_SIDES[number]

/**
 * Doubts about a source row, kept with it until somebody checks it: `unclear` (something after the range that is no
 * part of it, a side that contradicts the numbers), `reversed` (the range ran backwards and was turned round).
 */
export const DISTRICT_FLAGS = ['unclear', 'reversed'] as const
export type DistrictFlag = typeof DISTRICT_FLAGS[number]

/** One line of the list: the street as written, the house numbers (null/null = the whole street) and the district code. */
export interface DistrictRow {
  street: string
  fromNo: number | null
  /** Lower case letter after the number („3 A“ → 'a'), '' for none. */
  fromSuffix: string
  toNo: number | null
  toSuffix: string
  side: DistrictSide
  district: string
  flags: DistrictFlag[]
  note: string
}

/** A district code with the name of its school (from the list's legend or typed in). */
export interface DistrictLegendEntry { code: string; name: string }

export const SCHOOL_DISTRICT_LIMITS = {
  /** Upload size of a CSV or PDF. */
  maxBytes: 10 * 1024 * 1024,
  maxRows: 20_000,
  maxDistricts: 500,
  maxStreet: 120,
  maxCode: 10,
  maxName: 120,
  maxNote: 300,
  maxListName: 120,
  maxAsOf: 40,
  maxNumber: 9999,
  /** Lines that could not be read, reported back for the preview (the count is complete). */
  maxSkippedShown: 100,
} as const

// ---- normalising -------------------------------------------------------------

/**
 * The key a street is compared by: lower case, ß → ss, „Str.“/„Str“/„Straße“/„Strasse“ → strasse (also „Landstr“),
 * umlauts as ae/oe/ue (so „Mühlweg“ meets „Muehlweg“), other accents dropped, hyphens, spaces and dots removed.
 */
export function streetKey(street: string): string {
  const lower = street.normalize('NFC').toLocaleLowerCase('de-DE').replaceAll('ß', 'ss')
  return lower
    // „str.“ or „str“ ending a word (not the „str“ of „strasse“, „strand“ …).
    .replace(/str(?:\.|(?![a-zäöüéèàáâêîôû]))/g, 'strasse')
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** A district code as stored: trimmed, upper case; a number with two digits at least („1“, „01“, Excel’s „2“ → „01“, „02“). */
export function normalizeDistrictCode(code: string): string {
  const trimmed = code.trim().toUpperCase()
  if (/^\d{1,10}$/.test(trimmed)) return String(Number(trimmed)).padStart(2, '0')
  return trimmed
}

/**
 * Whether a (normalised) code may be stored: letters, digits, space, dot, hyphen and slash, starting with a letter or
 * digit, at most 10 characters – so no code can start a spreadsheet formula (= + - @).
 */
export const validDistrictCode = (code: string) => /^[0-9A-ZÄÖÜ][0-9A-ZÄÖÜ ./-]{0,9}$/.test(code)

const sideOf = (from: number, to: number): DistrictSide =>
  from % 2 !== to % 2 ? 'all' : from % 2 === 1 ? 'odd' : 'even'

// ---- reading source lines ----------------------------------------------------

/** House numbers of a row: „2- 14“, „4 - 20“, „1- 3 A“, „20“; what follows the range is kept as `rest`. */
const NUMBERS = /^(\d{1,4})\s*([a-z](?![a-z]))?\s*(?:[-–—]\s*(\d{1,4})\s*([a-z](?![a-z]))?)?(.*)$/i
/** A legend line: „1 Zeyherschule“, „01 = Südstadtschule“, „3: Nordstadtschule“. */
const LEGEND = /^(\d{1,3})\s*[-–:.)=]?\s+([a-zäöüß][^\d]{2,})$/i
/** Real lines are far shorter; anything longer is reported as not recognised before any pattern looks at it. */
const MAX_LINE = 300

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** A token that belongs to the house numbers: „2“, „2-“, „-“, „-14“, „2-14“, „3a“, „A“. */
const NUMBER_TOKEN = /^(?:\d{1,4}[a-z]?(?:[-–—](?:\d{1,4}[a-z]?)?)?|[-–—](?:\d{1,4}[a-z]?)?|[a-z])$/i

/**
 * A whole line of text split into street, house numbers (with stray numbers) and the district code at the end, in one
 * pass over its words (no backtracking): the code is the last word, the numbers the run of number words before it
 * (starting at the first one that begins with a digit), the street the rest, which must hold a letter.
 */
function splitLine(text: string): [string, string, string] | null {
  const words = text.split(' ')
  if (words.length < 3) return null
  const code = words[words.length - 1]!
  if (!/^[0-9a-z]{1,4}$/i.test(code)) return null
  let start = words.length - 1
  while (start > 1 && NUMBER_TOKEN.test(words[start - 1]!)) start--
  while (start < words.length - 1 && !/^\d/.test(words[start]!)) start++
  if (start >= words.length - 1) return null
  const street = words.slice(0, start).join(' ')
  return /[a-zäöüß]/i.test(street) ? [street, words.slice(start, -1).join(' '), code] : null
}

interface Numbers { fromNo: number; fromSuffix: string; toNo: number; toSuffix: string; flags: DistrictFlag[] }

/** The range of a numbers cell (turned round when reversed, flagged when something follows it), null when none. */
function readNumbers(cell: string): Numbers | null {
  const match = NUMBERS.exec(collapse(cell))
  if (!match) return null
  let fromNo = Number(match[1])
  let fromSuffix = (match[2] ?? '').toLowerCase()
  let toNo = match[3] === undefined ? fromNo : Number(match[3])
  let toSuffix = match[3] === undefined ? fromSuffix : (match[4] ?? '').toLowerCase()
  const flags: DistrictFlag[] = []
  if (match[5]!.trim() !== '') flags.push('unclear')
  if (fromNo > toNo || (fromNo === toNo && fromSuffix > toSuffix && toSuffix !== '')) {
    [fromNo, toNo, fromSuffix, toSuffix] = [toNo, fromNo, toSuffix, fromSuffix]
    flags.push('reversed')
  }
  return { fromNo, fromSuffix, toNo, toSuffix, flags }
}

/** A row from its three parts; null when the numbers cannot be read. An empty numbers cell is the whole street. */
function rowOf(street: string, numbersCell: string, district: string): DistrictRow | null {
  const name = collapse(street)
  const code = normalizeDistrictCode(district)
  if (!/[a-zäöüß]/i.test(name) || !validDistrictCode(code)) return null
  if (collapse(numbersCell) === '') {
    return { street: name, fromNo: null, fromSuffix: '', toNo: null, toSuffix: '', side: 'all', district: code, flags: [], note: '' }
  }
  const numbers = readNumbers(numbersCell)
  if (!numbers) return null
  const { flags, ...range } = numbers
  return {
    street: name, ...range, side: sideOf(range.fromNo, range.toNo), district: code, flags,
    note: flags.length ? `Quelle: „${collapse(numbersCell)}“` : '',
  }
}

export interface DistrictParseResult {
  rows: DistrictRow[]
  /** The names of the schools found in the list (its legend, or a CSV's „Schule“ column), by code. */
  legend: DistrictLegendEntry[]
  /** Lines with digits that are no row (the first `maxSkippedShown`). */
  skipped: string[]
  skippedCount: number
  /** More rows than allowed: the rest was dropped. */
  truncated: boolean
}

class Collector {
  rows: DistrictRow[] = []
  names = new Map<string, string>()
  skipped: string[] = []
  skippedCount = 0
  truncated = false

  add(row: DistrictRow): void {
    if (this.rows.length >= SCHOOL_DISTRICT_LIMITS.maxRows) this.truncated = true
    else this.rows.push(row)
  }

  name(code: string, name: string): void {
    const clean = collapse(name).slice(0, SCHOOL_DISTRICT_LIMITS.maxName)
    if (code && clean && !this.names.has(code)) this.names.set(code, clean)
  }

  skip(line: string): void {
    this.skippedCount++
    if (this.skipped.length < SCHOOL_DISTRICT_LIMITS.maxSkippedShown) this.skipped.push(line.slice(0, 200))
  }

  result(): DistrictParseResult {
    const legend = [...this.names].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }))
    return { rows: this.rows, legend, skipped: this.skipped, skippedCount: this.skippedCount, truncated: this.truncated }
  }
}

/** One line of cells: three cells are street, numbers, district; anything else is read as one line of text. */
function readLine(cells: readonly string[], into: Collector): void {
  let length = cells.length
  for (const cell of cells) length += cell.length
  if (length > MAX_LINE) {
    into.skip(`${cells.join(' ').slice(0, 120)} …`)
    return
  }
  const trimmed = cells.map(collapse)
  const text = collapse(trimmed.join(' '))
  if (text === '' || !/\d/.test(text)) return
  const legend = LEGEND.exec(text)
  if (legend) {
    into.name(normalizeDistrictCode(legend[1]!), legend[2]!)
    return
  }
  if (trimmed.length === 3) {
    const row = rowOf(trimmed[0]!, trimmed[1]!, trimmed[2]!)
    if (row) {
      into.add(row)
      return
    }
  }
  const parts = splitLine(text)
  const row = parts ? rowOf(...parts) : null
  if (row) into.add(row)
  else into.skip(text)
}

/** Reads the rows and the legend from lines of cells (a PDF's columns, or one cell per line of text). */
export function parseDistrictLines(lines: readonly (readonly string[])[]): DistrictParseResult {
  const into = new Collector()
  for (const cells of lines) readLine(cells, into)
  return into.result()
}

/** A text item of a PDF page: its text, position (left, baseline) and width. */
export interface PdfTextItem { str: string; x: number; y: number; w: number }

/** Items on baselines this close belong to one line. */
const SAME_LINE = 2.5
/** A gap this wide between two items starts a new column. */
const COLUMN_GAP = 12

/** The lines of each page, top to bottom, as cells: items left to right, a new cell after a wide gap. */
export function pdfLines(pages: readonly (readonly PdfTextItem[])[]): string[][] {
  const lines: string[][] = []
  for (const page of pages) {
    const words = page.filter(item => item.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x)
    const groups: PdfTextItem[][] = []
    for (const item of words) {
      const group = groups.at(-1)
      if (group && Math.abs(group[0]!.y - item.y) <= SAME_LINE) group.push(item)
      else groups.push([item])
    }
    for (const group of groups) {
      group.sort((a, b) => a.x - b.x)
      const cells: string[] = []
      let end = Number.NEGATIVE_INFINITY
      for (const item of group) {
        if (cells.length === 0 || item.x - end > COLUMN_GAP) cells.push(item.str.trim())
        else cells[cells.length - 1] = `${cells.at(-1)} ${item.str.trim()}`
        end = Math.max(end, item.x + item.w)
      }
      lines.push(cells.map(collapse))
    }
  }
  return lines
}

// ---- CSV -------------------------------------------------------------------

const BOM = '﻿'

/** The text of a CSV file: UTF-8 (BOM or not), else Windows-1252 (Excel on Windows). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.startsWith(BOM) ? text.slice(1) : text
}

/**
 * The separator: the most frequent of ; , and tab outside quotes in the first five non-empty lines (the first 64 KB;
 * ; when none), so a title line with a comma above a semicolon header does not decide it.
 */
function separatorOf(text: string): string {
  const lines = text.slice(0, 65_536).split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 5)
  const unquoted = lines.join('\n').replace(/"[^"\n]*"/g, '')
  const counts = [';', ',', '\t'].map(sep => ({ sep, count: unquoted.split(sep).length - 1 }))
  const best = counts.sort((a, b) => b.count - a.count)[0]!
  return best.count > 0 ? best.sep : ';'
}

/** Cells kept per record; a record with more is no row anyway (it is then reported as not recognised). */
const MAX_CELLS = 1000

/**
 * The records of a CSV text (quotes with "" inside, separators and line breaks inside quotes), read by slices between
 * separators, so a 10 MB file takes one pass.
 */
function csvRecords(text: string, sep: string): string[][] {
  const records: string[][] = []
  const length = text.length
  const endOfField = (from: number) => {
    let at = from
    while (at < length) {
      const char = text.charCodeAt(at)
      if (char === 10 || char === 13 || text[at] === sep) break
      at++
    }
    return at
  }
  let record: string[] = []
  let i = 0
  while (i < length) {
    let field: string
    if (text[i] === '"') {
      field = ''
      let from = i + 1
      for (;;) {
        const quote = text.indexOf('"', from)
        if (quote < 0) {
          field += text.slice(from)
          i = length
          break
        }
        field += text.slice(from, quote)
        if (text[quote + 1] === '"') {
          field += '"'
          from = quote + 2
        }
        else {
          i = quote + 1
          break
        }
      }
      const end = endOfField(i)
      field += text.slice(i, end)
      i = end
    }
    else {
      const end = endOfField(i)
      field = text.slice(i, end)
      i = end
    }
    if (record.length < MAX_CELLS) record.push(field)
    if (i < length && text[i] === sep) {
      i++
      if (i === length && record.length < MAX_CELLS) record.push('')
      continue
    }
    // A line break (CRLF, LF or CR) or the end of the text ends the record.
    if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10) i++
    i++
    records.push(record)
    record = []
  }
  if (record.length > 0) records.push(record)
  return records.filter(cells => cells.some(cell => cell.trim() !== ''))
}

type Column = 'street' | 'numbers' | 'from' | 'to' | 'side' | 'district' | 'school' | 'check' | 'note'

/** Header names (compared without case, umlauts and punctuation). */
const HEADERS: Record<Column, readonly string[]> = {
  street: ['strasse', 'strassenname', 'str', 'street'],
  numbers: ['hausnummer', 'hausnummern', 'hausnr', 'nr', 'nummern'],
  from: ['von', 'ab', 'vonnr', 'hausnummervon', 'nrvon'],
  to: ['bis', 'bisnr', 'hausnummerbis', 'nrbis'],
  side: ['seite', 'geradeungerade'],
  district: ['bezirk', 'schulbezirk', 'schulbezirke', 'code'],
  school: ['schule', 'schulname', 'name'],
  check: ['pruefen', 'pruefung'],
  note: ['hinweis', 'bemerkung', 'notiz'],
}

const headerKey = (cell: string) => streetKey(cell)

/** The column of each header cell; null when the line is no header (street, district and numbers or „von“ needed). */
function headerColumns(cells: readonly string[]): Map<Column, number> | null {
  const columns = new Map<Column, number>()
  cells.forEach((cell, index) => {
    const key = headerKey(cell)
    const column = (Object.keys(HEADERS) as Column[]).find(name => HEADERS[name].includes(key))
    if (column && !columns.has(column)) columns.set(column, index)
  })
  return columns.has('street') && columns.has('district') && (columns.has('numbers') || columns.has('from')) ? columns : null
}

const SIDE_WORDS: Record<string, DistrictSide> = {
  ungerade: 'odd', u: 'odd', odd: 'odd', gerade: 'even', g: 'even', even: 'even', alle: 'all', a: 'all', beide: 'all', all: 'all',
}

/** A cell as written, without the apostrophe the export puts before a formula character. */
const plain = (cell: string | undefined) => collapse((cell ?? '').replace(/^'(?=[=+\-@])/, ''))

/** A row from a CSV record with a header. */
function csvRow(cells: readonly string[], columns: Map<Column, number>, into: Collector): void {
  let length = cells.length
  for (const value of cells) length += value.length
  if (length > MAX_LINE * 2) {
    into.skip(`${cells.join(' | ').slice(0, 120)} …`)
    return
  }
  const cell = (column: Column) => plain(columns.has(column) ? cells[columns.get(column)!] : '')
  const numbers = columns.has('numbers')
    ? cell('numbers')
    : [cell('from'), cell('to')].filter(Boolean).join(' - ')
  const row = rowOf(cell('street'), numbers, cell('district'))
  if (!row) {
    into.skip(cells.map(plain).join(' | '))
    return
  }
  const side = SIDE_WORDS[cell('side').toLowerCase()]
  if (side && side !== row.side && row.fromNo !== null) {
    // A side that the numbers contradict (odd side with 2–14) is kept but needs a look.
    if (side !== 'all' && row.side !== 'all' && !row.flags.includes('unclear')) row.flags.push('unclear')
    row.side = side
  }
  if (/^(ja|j|x|1|yes)$/i.test(cell('check')) && !row.flags.includes('unclear')) row.flags.push('unclear')
  const note = cell('note')
  if (note) row.note = note.slice(0, SCHOOL_DISTRICT_LIMITS.maxNote)
  into.add(row)
  into.name(row.district, cell('school'))
}

/**
 * Reads a CSV text: with a header (in one of the first five records; title lines above it are left out) by its
 * columns, without one each record like a line of text.
 */
export function parseDistrictCsv(text: string): DistrictParseResult {
  const records = csvRecords(text, separatorOf(text))
  const into = new Collector()
  let headerAt = -1
  let columns: Map<Column, number> | null = null
  for (let index = 0; index < Math.min(5, records.length) && !columns; index++) {
    // A header line is short; a long record is no header (and not worth comparing).
    if (records[index]!.length <= 30 && records[index]!.every(cell => cell.length <= 60)) columns = headerColumns(records[index]!)
    if (columns) headerAt = index
  }
  for (const cells of columns ? records.slice(headerAt + 1) : records) {
    if (columns) csvRow(cells, columns, into)
    else readLine(cells.length === 3 ? cells.map(plain) : [cells.map(plain).join(' ')], into)
  }
  return into.result()
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Free text: a leading = + - @ would make Excel read a formula, so it gets a ' in front. */
const csvText = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value)

const SIDE_LABEL: Record<DistrictSide, string> = { odd: 'ungerade', even: 'gerade', all: 'alle' }

/** A house number as written in the CSV: „3“, „3a“, '' for none. */
export const houseNumberText = (no: number | null, suffix: string) => (no === null ? '' : `${no}${suffix}`)

/** The list as semicolon CSV (UTF-8 with BOM, CRLF), the format the import reads. */
export function districtCsv(rows: readonly DistrictRow[], names: readonly DistrictLegendEntry[]): string {
  const nameOf = new Map(names.map(entry => [entry.code, entry.name]))
  const lines = [
    ['Straße', 'von', 'bis', 'Seite', 'Bezirk', 'Schule', 'Prüfen', 'Hinweis'],
    ...rows.map(row => [
      csvText(row.street), houseNumberText(row.fromNo, row.fromSuffix), houseNumberText(row.toNo, row.toSuffix),
      SIDE_LABEL[row.side], csvText(row.district), csvText(nameOf.get(row.district) ?? ''), row.flags.length ? 'ja' : '', csvText(row.note),
    ]),
  ]
  return `${BOM}${lines.map(line => line.map(csvField).join(';')).join('\r\n')}\r\n`
}

/** A „Stand“ from the file name: the first year 19xx/20xx in it, '' when none. */
export function guessAsOf(fileName: string): string {
  return /(?:^|\D)((?:19|20)\d{2})(?!\d)/.exec(fileName)?.[1] ?? ''
}

// ---- overlaps and matching -----------------------------------------------------

/** Whether a row holds the house number (null: no number known, every row of the street counts). */
export function rowContains(row: Pick<DistrictRow, 'fromNo' | 'fromSuffix' | 'toNo' | 'toSuffix' | 'side'>, no: number | null, suffix: string): boolean {
  if (no === null || row.fromNo === null || row.toNo === null) return true
  if (row.side === 'odd' && no % 2 === 0) return false
  if (row.side === 'even' && no % 2 === 1) return false
  if (no < row.fromNo || no > row.toNo) return false
  // „ab 4b“ leaves out 4 and 4a; „bis 3a“ leaves out 3b, „bis 3“ takes every 3x.
  if (no === row.fromNo && row.fromSuffix !== '' && suffix < row.fromSuffix) return false
  if (no === row.toNo && row.toSuffix !== '' && suffix > row.toSuffix) return false
  return true
}

type RangeRow = Pick<DistrictRow, 'fromNo' | 'fromSuffix' | 'toNo' | 'toSuffix' | 'side'>

/** A range end as one comparable value: the number, then the suffix („bis 3“ takes every 3x, so its end is 3 + all). */
const point = (no: number, suffix: string, end: boolean) => no * 64 + (suffix === '' ? (end ? 63 : 0) : suffix.charCodeAt(0) - 96)

/** Whether two rows of one street share a house number (by numbers, suffixes at the borders, and side). */
function rangesMeet(a: RangeRow, b: RangeRow): boolean {
  if (a.fromNo === null || a.toNo === null || b.fromNo === null || b.toNo === null) return true
  const lowPoint = Math.max(point(a.fromNo, a.fromSuffix, false), point(b.fromNo, b.fromSuffix, false))
  const highPoint = Math.min(point(a.toNo, a.toSuffix, true), point(b.toNo, b.toSuffix, true))
  if (lowPoint > highPoint) return false
  const low = Math.floor(lowPoint / 64)
  const high = Math.floor(highPoint / 64)
  const side = a.side === 'all' ? b.side : b.side === 'all' || b.side === a.side ? a.side : null
  if (side === null) return false
  if (side === 'all') return true
  const first = (low % 2 === 1) === (side === 'odd') ? low : low + 1
  return first <= high
}

/** The indexes of the rows that share a house number of their street with a row of another district. */
export function overlappingRows(rows: readonly Pick<DistrictRow, 'street' | 'fromNo' | 'fromSuffix' | 'toNo' | 'toSuffix' | 'side' | 'district'>[]): Set<number> {
  const byStreet = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const key = streetKey(row.street)
    const list = byStreet.get(key) ?? []
    list.push(index)
    byStreet.set(key, list)
  })
  const found = new Set<number>()
  for (const indexes of byStreet.values()) {
    for (let i = 0; i < indexes.length; i++) {
      for (let j = i + 1; j < indexes.length; j++) {
        const a = rows[indexes[i]!]!
        const b = rows[indexes[j]!]!
        if (a.district !== b.district && rangesMeet(a, b)) {
          found.add(indexes[i]!)
          found.add(indexes[j]!)
        }
      }
    }
  }
  return found
}

/** Street, house number and suffix read from a child's address (the first line with a number; postcode lines skipped). */
export interface ParsedAddress { street: string; no: number | null; suffix: string }

const POSTCODE_LINE = /^(?:D-)?\d{5}(?:\s|$)/i
/** A postcode with the town after it, also within the line („Ahornweg 12 68723 Musterstadt“). */
const POSTCODE_TAIL = /(?:^|\s)(?:D-)?\d{5}(?:\s.*)?$/i
const ADDRESS_LINE = /^(.*[a-zäöüß.].*?)\s*(\d{1,4})\s*([a-z](?![a-zäöüß]))?(?:\s*[-–/]\s*\d{1,4}\s*[a-z]?)?\s*$/i

/** A part of the address without a postcode and town at its end, and without what separated them („·“, „in“). */
const withoutTown = (part: string) => part.slice(0, 200).replace(POSTCODE_TAIL, '').replace(/[\s·•|/:–-]+$/, '').replace(/\s+(?:in|bei)$/i, '').trim()

/**
 * Street and house number of an address field („Ahornweg 12a\n68723 Musterstadt“, also on one line); null when it holds
 * no street.
 */
export function parseAddress(address: string): ParsedAddress | null {
  const parts = address.split(/[\r\n,;]+/).map(collapse).filter(part => part !== '' && !POSTCODE_LINE.test(part)).map(withoutTown)
    .filter(part => part !== '')
  for (const part of parts) {
    const match = ADDRESS_LINE.exec(part)
    if (match) return { street: match[1]!.trim(), no: Number(match[2]), suffix: (match[3] ?? '').toLowerCase() }
  }
  const street = parts.find(part => /[a-zäöüß]/i.test(part))
  return street ? { street, no: null, suffix: '' } : null
}

/** The rows needed for matching, with their street key. */
export type IndexRow = Pick<DistrictRow, 'fromNo' | 'fromSuffix' | 'toNo' | 'toSuffix' | 'side' | 'district'>

/**
 * Where the rows of a street key come from: all at once (`buildDistrictIndex`), or looked up one key at a time in the
 * database (the server's matcher), with the keys of the truncated-looking streets only for the prefix rule.
 */
export interface DistrictLookup {
  rowsOf: (key: string) => readonly IndexRow[]
  /** The keys of the list's streets that look truncated (`looksTruncated`). */
  truncatedKeys: () => readonly string[]
}

/** Endings of a complete street name (as in the key): a name ending like this is not cut off. */
const COMPLETE_ENDINGS = [
  'strasse', 'weg', 'platz', 'ring', 'allee', 'gasse', 'pfad', 'anlage', 'hof', 'ufer', 'steige', 'steig', 'stieg', 'damm',
  'markt', 'park', 'garten', 'gaerten', 'berg', 'feld', 'wald', 'graben', 'bruecke', 'tor', 'grund', 'hoehe', 'winkel',
  'zeile', 'chaussee', 'promenade', 'kai', 'rain', 'aue', 'acker', 'aecker', 'wiese', 'wiesen', 'buckel', 'gewann', 'sand',
  'siedlung', 'viertel', 'bogen', 'kamp', 'ried', 'eck', 'ecke', 'blick', 'heide', 'busch', 'holz', 'tal', 'hang', 'brunnen',
  'bach', 'muehle', 'schloss', 'rondell', 'chen',
]

/**
 * Whether a street of the list looks cut off by its source (the column width of the city's list): it ends in an
 * abbreviation of „Straße“ („…-St“, „…Str“, „…Landst“), or it is long (22+ characters) without a complete street ending.
 * Only such names are matched as the beginning of a longer address name („Clementine-Bassermann-St“); „Am Alten
 * Rathaus“ never stands for „Am Alten Rathausplatz“.
 */
export function looksTruncated(street: string): boolean {
  const name = collapse(street)
  if (/(?:[\s.-](?:st|str|stra|stras|straß)|landstr?)\.?$/i.test(name)) return true
  const key = streetKey(name)
  return name.length >= 22 && !COMPLETE_ENDINGS.some(ending => key.endsWith(ending))
}

/** A lookup over rows held in memory. */
export function buildDistrictIndex(rows: readonly (IndexRow & { street: string })[]): DistrictLookup {
  const byKey = new Map<string, IndexRow[]>()
  const truncated = new Set<string>()
  for (const row of rows) {
    const key = streetKey(row.street)
    const list = byKey.get(key) ?? []
    list.push(row)
    byKey.set(key, list)
    if (looksTruncated(row.street)) truncated.add(key)
  }
  const keys = [...truncated]
  return { rowsOf: key => byKey.get(key) ?? [], truncatedKeys: () => keys }
}

/** A truncated name of the list is only tried as a prefix with at least this many letters. */
const MIN_PREFIX = 8

/**
 * The street key of the list the address key stands for: itself, else the one truncated list key it starts with –
 * never for an address key with digits in it (something in the address was not read as the house number).
 */
function listKeyFor(lookup: DistrictLookup, key: string): string | null {
  if (lookup.rowsOf(key).length > 0) return key
  if (/\d/.test(key)) return null
  const prefixes = lookup.truncatedKeys().filter(candidate => candidate.length >= MIN_PREFIX && candidate.length < key.length && key.startsWith(candidate))
  return prefixes.length === 1 ? prefixes[0]! : null
}

export type DistrictMatch =
  | { kind: 'match'; code: string }
  | { kind: 'ambiguous'; codes: string[] }
  | { kind: 'none' }
  | { kind: 'noAddress' }

/** The district of an address: exactly one, several (overlapping rows), none, or no address to look at. */
export function matchAddress(lookup: DistrictLookup, address: string): DistrictMatch {
  const parsed = parseAddress(address)
  if (!parsed) return { kind: 'noAddress' }
  const key = listKeyFor(lookup, streetKey(parsed.street))
  if (key === null) return { kind: 'none' }
  const codes = [...new Set(lookup.rowsOf(key).filter(row => rowContains(row, parsed.no, parsed.suffix)).map(row => row.district))]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
  if (codes.length === 0) return { kind: 'none' }
  return codes.length === 1 ? { kind: 'match', code: codes[0]! } : { kind: 'ambiguous', codes }
}
