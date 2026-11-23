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
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed)).padStart(2, '0')
  return trimmed
}

const sideOf = (from: number, to: number): DistrictSide =>
  from % 2 !== to % 2 ? 'all' : from % 2 === 1 ? 'odd' : 'even'

// ---- reading source lines ----------------------------------------------------

/** House numbers of a row: „2- 14“, „4 - 20“, „1- 3 A“, „20“; what follows the range is kept as `rest`. */
const NUMBERS = /^(\d{1,4})\s*([a-z](?![a-z]))?\s*(?:[-–—]\s*(\d{1,4})\s*([a-z](?![a-z]))?)?(.*)$/i
/** A whole line of text: street, house numbers (plus stray numbers), district code at the end. */
const LINE = /^(.*?[a-zäöüß].*?)\s+(\d{1,4}\s*(?:[a-z](?![a-zäöüß]))?\s*(?:[-–—]\s*\d{1,4}(?:\s*[a-z](?![a-zäöüß]))?)?(?:\s+\d{1,4})*)\s+([0-9a-z]{1,4})$/i
/** A legend line: „1 Zeyherschule“, „01 = Südstadtschule“, „3: Nordstadtschule“. */
const LEGEND = /^(\d{1,3})\s*[-–:.)=]?\s+([a-zäöüß][^\d]{2,})$/i

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

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
  if (!/[a-zäöüß]/i.test(name) || code === '') return null
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
  const match = LINE.exec(text)
  const row = match ? rowOf(match[1]!, match[2]!, match[3]!) : null
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

/** The separator of the first line: the most frequent of ; , and tab outside quotes (; when none). */
function separatorOf(text: string): string {
  const first = text.split(/\r?\n/).find(line => line.trim() !== '') ?? ''
  const unquoted = first.replace(/"[^"]*"/g, '')
  const counts = [';', ',', '\t'].map(sep => ({ sep, count: unquoted.split(sep).length - 1 }))
  const best = counts.sort((a, b) => b.count - a.count)[0]!
  return best.count > 0 ? best.sep : ';'
}

/** The records of a CSV text (quotes with "" inside, separators and line breaks inside quotes). */
function csvRecords(text: string, sep: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      }
      else if (char === '"') quoted = false
      else field += char
    }
    else if (char === '"' && field.trim() === '') {
      quoted = true
      field = ''
    }
    else if (char === sep) {
      record.push(field)
      field = ''
    }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    }
    else field += char
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
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

/** Reads a CSV text: with a header by its columns, without one each record like a line of text. */
export function parseDistrictCsv(text: string): DistrictParseResult {
  const records = csvRecords(text, separatorOf(text))
  const into = new Collector()
  const columns = records.length ? headerColumns(records[0]!) : null
  for (const cells of columns ? records.slice(1) : records) {
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
      SIDE_LABEL[row.side], row.district, csvText(nameOf.get(row.district) ?? ''), row.flags.length ? 'ja' : '', csvText(row.note),
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

type RangeRow = Pick<DistrictRow, 'fromNo' | 'toNo' | 'side'>

/** Whether two rows of one street share a house number (by numbers and side; suffixes are not looked at). */
function rangesMeet(a: RangeRow, b: RangeRow): boolean {
  if (a.fromNo === null || a.toNo === null || b.fromNo === null || b.toNo === null) return true
  const low = Math.max(a.fromNo, b.fromNo)
  const high = Math.min(a.toNo, b.toNo)
  if (low > high) return false
  const side = a.side === 'all' ? b.side : b.side === 'all' || b.side === a.side ? a.side : null
  if (side === null) return false
  if (side === 'all') return true
  const first = (low % 2 === 1) === (side === 'odd') ? low : low + 1
  return first <= high
}

/** The indexes of the rows that share a house number of their street with a row of another district. */
export function overlappingRows(rows: readonly Pick<DistrictRow, 'street' | 'fromNo' | 'toNo' | 'side' | 'district'>[]): Set<number> {
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
const ADDRESS_LINE = /^(.*[a-zäöüß.].*?)\s*(\d{1,4})\s*([a-z](?![a-zäöüß]))?(?:\s*[-–/]\s*\d{1,4}\s*[a-z]?)?\s*$/i

/** Street and house number of an address field („Ahornweg 12a\n68723 Musterstadt“); null when it holds no street. */
export function parseAddress(address: string): ParsedAddress | null {
  const parts = address.split(/[\r\n,;]+/).map(collapse).filter(part => part !== '' && !POSTCODE_LINE.test(part))
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
 * database (the server's matcher), with the list of all keys only for the prefix rule.
 */
export interface DistrictLookup {
  rowsOf: (key: string) => readonly IndexRow[]
  keys: () => readonly string[]
}

/** A lookup over rows held in memory. */
export function buildDistrictIndex(rows: readonly (IndexRow & { street: string })[]): DistrictLookup {
  const byKey = new Map<string, IndexRow[]>()
  for (const row of rows) {
    const key = streetKey(row.street)
    const list = byKey.get(key) ?? []
    list.push(row)
    byKey.set(key, list)
  }
  const keys = [...byKey.keys()]
  return { rowsOf: key => byKey.get(key) ?? [], keys: () => keys }
}

/** A truncated name of the list („Clementine-Bassermann-St“) is only tried as a prefix with at least this many letters. */
const MIN_PREFIX = 8

/** The street key of the list the address key stands for: itself, else the one list key it starts with. */
function listKeyFor(lookup: DistrictLookup, key: string): string | null {
  if (lookup.rowsOf(key).length > 0) return key
  const prefixes = lookup.keys().filter(candidate => candidate.length >= MIN_PREFIX && candidate.length < key.length && key.startsWith(candidate))
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
