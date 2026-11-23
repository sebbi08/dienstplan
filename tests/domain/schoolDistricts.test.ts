import { describe, expect, it } from 'vitest'
import {
  buildDistrictIndex, decodeCsvBytes, districtCsv, guessAsOf, looksTruncated, matchAddress, MAX_CSV_RECORDS, normalizeDistrictCode, overlappingRows,
  parseAddress, parseDistrictCsv, parseDistrictCsvInSlices, parseDistrictLines, parseDistrictLinesInSlices, pdfLines, rowContains, streetKey,
  validDistrictCode, type DistrictRow,
} from '../../shared/domain/schoolDistricts'

/** A row with the defaults of a clean source line. */
const row = (street: string, from: number | null, to: number | null, district: string, extra: Partial<DistrictRow> = {}): DistrictRow => ({
  street, fromNo: from, fromSuffix: '', toNo: to, toSuffix: '',
  side: from === null || to === null ? 'all' : from % 2 === to % 2 ? (from % 2 === 1 ? 'odd' : 'even') : 'all',
  district, flags: [], note: '', ...extra,
})

/**
 * A synthetic list with the quirks of the real one (a city's Schulbezirke as a PDF text layer): header line, spaces in
 * the ranges, suffix letters, a stray digit after the range, a reversed range, truncated names, overlapping ranges of
 * one side with another district, and the legend of the schools at the end.
 */
const FIXTURE: string[][] = [
  ['Schulbezirke', 'Hausnummer', 'Schulbezirke'],
  ['Ahornweg', '2- 14', '04'],
  ['Ahornweg', '3- 37', '04'],
  ['Bahnhofanlage', '1- 3 A', '02'],
  ['Bahnhofanlage', '2- 36', '02'],
  ['Erfurter Straße', '4 - 20', '03'],
  ['Carl-Benz-Straße', '1- 23 1', '01'],
  ['Markgrafenstraße', '22 - 14', '02'],
  ['Tilsiter Weg', '1- 7 9', '03'],
  ['Clementine-Bassermann-St', '1- 27', '02'],
  ['Friedrichsfelder Landstr', '21- 41', '04'],
  ['Friedrich-Ebert-Straße', '2- 84', '01'],
  ['Friedrich-Ebert-Straße', '22- 82', '03'],
  ['Alter Mühlweg', '20- 20', '03'],
  ['1 Zeyherschule'],
  ['2 Südstadtschule'],
  ['3 Nordstadtschule'],
  ['4 Hirschackerschule'],
]

describe('school district street keys', () => {
  it('folds case, ß, umlauts, hyphens, spaces and the „Straße“ spellings into one key', () => {
    expect(streetKey('Erfurter Straße')).toBe('erfurterstrasse')
    expect(streetKey('Erfurter Str.')).toBe('erfurterstrasse')
    expect(streetKey('erfurter strasse')).toBe('erfurterstrasse')
    expect(streetKey('Erfurter-Str')).toBe('erfurterstrasse')
    expect(streetKey('Friedrichsfelder Landstr')).toBe(streetKey('Friedrichsfelder Landstraße'))
    expect(streetKey('Carl-Benz-Straße')).toBe(streetKey('Carl Benz Strasse'))
    // Umlauts compare with their ae/oe/ue spelling.
    expect(streetKey('Alter Mühlweg')).toBe(streetKey('Alter Muehlweg'))
    expect(streetKey('Zähringerstraße')).toBe('zaehringerstrasse')
    // „Strand“ or „Straßburg“ stay what they are.
    expect(streetKey('Am Strand')).toBe('amstrand')
  })

  it('pads numeric district codes to two digits, so „1“, „01“ and Excel’s „2“ meet', () => {
    expect(normalizeDistrictCode(' 1 ')).toBe('01')
    expect(normalizeDistrictCode('02')).toBe('02')
    expect(normalizeDistrictCode('12')).toBe('12')
    expect(normalizeDistrictCode('004')).toBe('04')
    expect(normalizeDistrictCode('nord')).toBe('NORD')
    expect(normalizeDistrictCode('')).toBe('')
  })
})

describe('parsing a district list', () => {
  const result = parseDistrictLines(FIXTURE)
  const of = (street: string) => result.rows.filter(entry => entry.street === street)

  it('reads street, range, side and district, skipping the header', () => {
    expect(of('Ahornweg')).toEqual([row('Ahornweg', 2, 14, '04'), row('Ahornweg', 3, 37, '04')])
    expect(of('Erfurter Straße')).toEqual([row('Erfurter Straße', 4, 20, '03')])
    expect(of('Alter Mühlweg')).toEqual([row('Alter Mühlweg', 20, 20, '03')])
    expect(result.skipped).toEqual([])
  })

  it('reads a suffix letter at the end of the range', () => {
    expect(of('Bahnhofanlage')[0]).toEqual(row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' }))
  })

  it('keeps the range before a stray number and flags the row as unclear, with the source in the note', () => {
    expect(of('Carl-Benz-Straße')).toEqual([row('Carl-Benz-Straße', 1, 23, '01', { flags: ['unclear'], note: 'Quelle: „1- 23 1“' })])
    expect(of('Tilsiter Weg')).toEqual([row('Tilsiter Weg', 1, 7, '03', { flags: ['unclear'], note: 'Quelle: „1- 7 9“' })])
  })

  it('turns a reversed range round and flags it', () => {
    expect(of('Markgrafenstraße')).toEqual([row('Markgrafenstraße', 14, 22, '02', { flags: ['reversed'], note: 'Quelle: „22 - 14“' })])
  })

  it('keeps truncated names as written', () => {
    expect(of('Clementine-Bassermann-St')).toHaveLength(1)
    expect(of('Friedrichsfelder Landstr')).toHaveLength(1)
  })

  it('reads the legend of the schools as district names', () => {
    expect(result.legend).toEqual([
      { code: '01', name: 'Zeyherschule' }, { code: '02', name: 'Südstadtschule' }, { code: '03', name: 'Nordstadtschule' },
      { code: '04', name: 'Hirschackerschule' },
    ])
  })

  it('reads plain text lines the same way as columns', () => {
    const text = parseDistrictLines([
      ['Ahornweg 2- 14 04'], ['Bahnhofanlage 1- 3 A 02'], ['Carl-Benz-Straße 1- 23 1 01'], ['Markgrafenstraße 22 - 14 02'],
      ['Tilsiter Weg 1- 7 9 03'], ['Straße des 17. Juni 1- 9 05'], ['Seite 3 von 8'], ['1 Zeyherschule'],
    ])
    expect(text.rows).toEqual([
      row('Ahornweg', 2, 14, '04'),
      row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' }),
      row('Carl-Benz-Straße', 1, 23, '01', { flags: ['unclear'], note: 'Quelle: „1- 23 1“' }),
      row('Markgrafenstraße', 14, 22, '02', { flags: ['reversed'], note: 'Quelle: „22 - 14“' }),
      row('Tilsiter Weg', 1, 7, '03', { flags: ['unclear'], note: 'Quelle: „1- 7 9“' }),
      row('Straße des 17. Juni', 1, 9, '05'),
    ])
    expect(text.legend).toEqual([{ code: '01', name: 'Zeyherschule' }])
    // A line with digits that is no row is reported, not dropped silently.
    expect(text.skipped).toEqual(['Seite 3 von 8'])
  })

  it('takes a street without numbers as the whole street, and a mixed-parity range as both sides', () => {
    const lines = parseDistrictLines([['Marktplatz', '', '02'], ['Kurze Gasse', '1- 4', '03']])
    expect(lines.rows).toEqual([row('Marktplatz', null, null, '02'), row('Kurze Gasse', 1, 4, '03', { side: 'all' })])
  })
})

describe('building lines from the PDF text layer', () => {
  it('groups the items by baseline, orders them and splits the columns at wide gaps', () => {
    const items = [
      { str: '04', x: 347.8, y: 743.7, w: 11 },
      { str: 'Ahornweg', x: 52.9, y: 743.7, w: 46.8 },
      { str: ' ', x: 99.8, y: 743.7, w: 105.4 },
      { str: '2- 14', x: 205.1, y: 743.7, w: 22.1 },
      { str: 'Am', x: 52.9, y: 728.9, w: 14 },
      { str: 'Langen Sand', x: 69.5, y: 729.4, w: 60 },
      { str: '1- 41', x: 205.1, y: 728.9, w: 22.1 },
      { str: '03', x: 347.8, y: 728.9, w: 11 },
      { str: '1', x: 103.5, y: 700, w: 5.5 },
      { str: ' ', x: 108.9, y: 700, w: 3.9 },
      { str: 'Zeyherschule', x: 112.8, y: 700, w: 61.9 },
    ]
    expect(pdfLines([items, [{ str: 'Zeyherstraße', x: 52.9, y: 773.5, w: 61.6 }, { str: '1- 3', x: 205.1, y: 773.5, w: 16.6 }, { str: '02', x: 347.8, y: 773.5, w: 11 }]])).toEqual([
      ['Ahornweg', '2- 14', '04'],
      ['Am Langen Sand', '1- 41', '03'],
      ['1 Zeyherschule'],
      ['Zeyherstraße', '1- 3', '02'],
    ])
  })
})

describe('CSV import and export', () => {
  it('decodes UTF-8 (with or without BOM) and falls back to Windows-1252', () => {
    expect(decodeCsvBytes(new Uint8Array([0xEF, 0xBB, 0xBF, ...Buffer.from('Straße', 'utf8')]))).toBe('Straße')
    expect(decodeCsvBytes(new Uint8Array(Buffer.from('Mühlweg', 'utf8')))).toBe('Mühlweg')
    // „Mühlweg;Straße“ as Excel saves it on Windows.
    expect(decodeCsvBytes(new Uint8Array([0x4D, 0xFC, 0x68, 0x6C, 0x77, 0x65, 0x67, 0x3B, 0x53, 0x74, 0x72, 0x61, 0xDF, 0x65]))).toBe('Mühlweg;Straße')
  })

  it('reads semicolon CSV with the export’s columns, side and school names', () => {
    const csv = 'Straße;von;bis;Seite;Bezirk;Schule;Prüfen;Hinweis\r\n'
      + 'Ahornweg;2;14;gerade;4;Hirschackerschule;;\r\n'
      + '"Bahnhofanlage";1;3a;ungerade;02;Südstadtschule;;\r\n'
      + 'Marktplatz;;;alle;02;;;ganze Straße\r\n'
      + 'Carl-Benz-Straße;1;23;ungerade;01;;ja;Quelle: „1- 23 1“\r\n'
    const result = parseDistrictCsv(csv)
    expect(result.rows).toEqual([
      row('Ahornweg', 2, 14, '04'),
      row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' }),
      row('Marktplatz', null, null, '02', { note: 'ganze Straße' }),
      row('Carl-Benz-Straße', 1, 23, '01', { flags: ['unclear'], note: 'Quelle: „1- 23 1“' }),
    ])
    // The names come sorted by code, the first name of a code wins.
    expect(result.legend).toEqual([{ code: '02', name: 'Südstadtschule' }, { code: '04', name: 'Hirschackerschule' }])
  })

  it('reads comma CSV with a combined „Hausnummer“ column, and flags a side that contradicts the numbers', () => {
    const result = parseDistrictCsv('Strasse,Hausnummer,Schulbezirk\nErfurter Str.,4 - 20,03\nMarkgrafenstraße,22 - 14,02\nTilsiter Weg,"1- 7 9",03\n')
    expect(result.rows).toEqual([
      row('Erfurter Str.', 4, 20, '03'),
      row('Markgrafenstraße', 14, 22, '02', { flags: ['reversed'], note: 'Quelle: „22 - 14“' }),
      row('Tilsiter Weg', 1, 7, '03', { flags: ['unclear'], note: 'Quelle: „1- 7 9“' }),
    ])
    const sides = parseDistrictCsv('Straße;von;bis;Seite;Bezirk\nAhornweg;2;14;ungerade;04\n')
    expect(sides.rows[0]).toMatchObject({ side: 'odd', flags: ['unclear'] })
  })

  it('reads CSV without a header like text lines', () => {
    expect(parseDistrictCsv('Ahornweg;2- 14;04\r\nBahnhofanlage 1- 3 A 02\r\n').rows).toEqual([
      row('Ahornweg', 2, 14, '04'), row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' }),
    ])
  })

  it('writes semicolon CSV (BOM, CRLF) that reads back to the same rows and names', () => {
    const rows = [
      row('Ahornweg', 2, 14, '04'),
      row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' }),
      row('Marktplatz', null, null, '02', { note: 'ganze Straße; auch Hinterhaus' }),
      row('=Formelweg', 1, 9, '01', { flags: ['unclear'] }),
    ]
    const csv = districtCsv(rows, [{ code: '02', name: 'Südstadtschule' }, { code: '04', name: 'Hirschackerschule' }])
    expect(csv.startsWith('﻿Straße;von;bis;Seite;Bezirk;Schule;Prüfen;Hinweis\r\n')).toBe(true)
    expect(csv).toContain('Bahnhofanlage;1;3a;ungerade;02;Südstadtschule;;\r\n')
    expect(csv).toContain('"ganze Straße; auch Hinterhaus"')
    expect(csv).toContain("'=Formelweg;1;9;ungerade;01;;ja;")
    const back = parseDistrictCsv(decodeCsvBytes(new Uint8Array(Buffer.from(csv, 'utf8'))))
    expect(back.rows.slice(0, 3)).toEqual(rows.slice(0, 3))
    expect(back.legend).toEqual([{ code: '02', name: 'Südstadtschule' }, { code: '04', name: 'Hirschackerschule' }])
  })

  it('reads long lines in linear time and reports them instead of matching', () => {
    const line = `a${' 1'.repeat(16_000)} !`
    let started = performance.now()
    const text = parseDistrictLines([[line]])
    expect(performance.now() - started).toBeLessThan(50)
    expect(text).toMatchObject({ rows: [], skippedCount: 1 })
    expect(text.skipped[0]!.length).toBeLessThan(130)
    // A 10 MB file without line breaks, with and without separators.
    for (const big of ['Ahornweg 2- 14 04 '.repeat(580_000), `Straße;Hausnummer;Bezirk\n${'x;'.repeat(5_000_000)}`]) {
      started = performance.now()
      const result = parseDistrictCsv(big)
      expect(performance.now() - started).toBeLessThan(3000)
      expect(result.rows).toEqual([])
      expect(result.skippedCount).toBe(1)
    }
  })

  it('drops blank records while reading: 10 MB of empty lines or Excel’s „;;;“ rows cost no memory', () => {
    for (const blank of ['\n'.repeat(10 * 1024 * 1024), ';;;\r\n'.repeat(2 * 1024 * 1024), `Straße;Hausnummer;Bezirk\r\n${';;\r\n'.repeat(2 * 1024 * 1024)}Ahornweg;2-14;04\r\n`]) {
      const before = process.memoryUsage().heapUsed
      const started = performance.now()
      const result = parseDistrictCsv(blank)
      expect(performance.now() - started).toBeLessThan(3000)
      expect(process.memoryUsage().heapUsed - before).toBeLessThan(50 * 1024 * 1024)
      expect(result.skippedCount).toBe(0)
      expect(result.truncated).toBe(false)
    }
    // A row after 100 000 blank ones is still found.
    expect(parseDistrictCsv(`Straße;Hausnummer;Bezirk\r\n${';;\r\n'.repeat(100_000)}Ahornweg;2-14;04\r\n`).rows).toEqual([row('Ahornweg', 2, 14, '04')])
  })

  it('counts cells of Unicode white space as blank', () => {
    const blanks = ['　;;', '﻿;;', ' ; ;', ' '].join('\n')
    const result = parseDistrictCsv(`${`${blanks}\n`.repeat(20_000)}Straße;Hausnummer;Bezirk\nAhornweg;2-14;04\n`)
    expect(result).toMatchObject({ skippedCount: 0, truncated: false })
    expect(result.rows).toEqual([row('Ahornweg', 2, 14, '04')])
  })

  it('reads a large file in slices, never holding the event loop for long', async () => {
    const wide = `${Array.from({ length: 100 }, (_, index) => `x${index}`).join(';')}\n`
    const text = `${'\n'.repeat(2 * 1024 * 1024)}${wide.repeat(20_000)}`
    let longest = 0
    let last = performance.now()
    const ticker = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 5)
    const sliced = await parseDistrictCsvInSlices(text)
    clearInterval(ticker)
    const started = performance.now()
    const whole = parseDistrictCsv(text)
    const oneGo = performance.now() - started
    // In slices of 20 ms every gap stays far below the time in one go (a garbage collection included).
    expect(longest, `longest gap ${Math.round(longest)} ms, in one go ${Math.round(oneGo)} ms`).toBeLessThan(Math.max(300, oneGo / 2))
    expect(longest).toBeLessThan(1000)
    // Same result as in one go.
    expect(sliced).toEqual(whole)
    expect(await parseDistrictLinesInSlices([['Ahornweg', '2- 14', '04']])).toEqual(parseDistrictLines([['Ahornweg', '2- 14', '04']]))
  })

  it('reads at most 50 000 records and 20 000 rows, and says so', () => {
    const lines = parseDistrictCsv('kein Treffer 1\n'.repeat(MAX_CSV_RECORDS + 10))
    expect(lines).toMatchObject({ rows: [], skippedCount: MAX_CSV_RECORDS, truncated: true })
    const rows = parseDistrictCsv(Array.from({ length: 20_005 }, (_, index) => `Weg ${index};1-3;01`).join('\n'))
    expect(rows.rows).toHaveLength(20_000)
    expect(rows.truncated).toBe(true)
  })

  it('keeps district codes to letters, digits, space, dot, hyphen and slash, and never writes a formula', () => {
    const result = parseDistrictCsv('Straße;Hausnummer;Bezirk\nAhornweg;2-14;=1+1\nBirkenweg;1-9;@SUM(A1)\nEichenweg;1-9;N-1/2\nUlmenweg;1-9;-2\n')
    expect(result.rows.map(entry => [entry.street, entry.district])).toEqual([['Eichenweg', 'N-1/2']])
    expect(result.skippedCount).toBe(3)
    expect(validDistrictCode('02')).toBe(true)
    expect(validDistrictCode('NORD 2')).toBe(true)
    for (const code of ['=1+1', '+A1', '-2', '@X', 'A;B', 'ELF ZEICHEN']) expect(validDistrictCode(code), code).toBe(false)
    // Written defensively all the same.
    expect(districtCsv([row('Weg', 1, 3, '-2')], [])).toContain(";'-2;")
  })

  it('finds the header below a title line', () => {
    const result = parseDistrictCsv('Schulbezirke der Stadt, Stand 2021\n\nStraße;von;bis;Seite;Bezirk;Schule;Prüfen;Hinweis\nAhornweg;2;14;gerade;04;Hirschackerschule;;\n')
    expect(result.rows).toEqual([row('Ahornweg', 2, 14, '04')])
    expect(result.legend).toEqual([{ code: '04', name: 'Hirschackerschule' }])
  })

  it('guesses the „Stand“ from a year in the file name', () => {
    expect(guessAsOf('schulbezirke-2021.pdf')).toBe('2021')
    expect(guessAsOf('Schulbezirke.csv')).toBe('')
  })
})

describe('overlaps', () => {
  it('marks rows of one street and side whose ranges meet with another district', () => {
    const rows = [
      row('Friedrich-Ebert-Straße', 2, 84, '01'), row('Friedrich-Ebert-Straße', 22, 82, '03'), row('Friedrich-Ebert-Straße', 1, 99, '01'),
      row('Ahornweg', 2, 14, '04'), row('Ahornweg', 3, 37, '02'), row('Ahorn Weg', 16, 20, '03'),
      row('Marktplatz', null, null, '02'), row('Marktplatz', 4, 4, '01'),
    ]
    expect([...overlappingRows(rows)].sort()).toEqual([0, 1, 6, 7])
  })

  it('looks at the suffixes where two ranges touch', () => {
    expect(overlappingRows([row('Weg', 1, 3, '02', { toSuffix: 'a' }), row('Weg', 3, 9, '03', { fromSuffix: 'b' })]).size).toBe(0)
    expect(overlappingRows([row('Weg', 1, 3, '02', { toSuffix: 'b' }), row('Weg', 3, 9, '03', { fromSuffix: 'b' })]).size).toBe(2)
    // „bis 3“ takes every 3x, so it meets „ab 3b“.
    expect(overlappingRows([row('Weg', 1, 3, '02'), row('Weg', 3, 9, '03', { fromSuffix: 'b' })]).size).toBe(2)
  })
})

describe('house numbers and addresses', () => {
  it('reads street and number (with suffix) from the address field', () => {
    expect(parseAddress('Ahornweg 12a\n68723 Musterstadt')).toEqual({ street: 'Ahornweg', no: 12, suffix: 'a' })
    expect(parseAddress('Bahnhofanlage 3 A, 68723 Musterstadt')).toEqual({ street: 'Bahnhofanlage', no: 3, suffix: 'a' })
    expect(parseAddress('Erfurter Str.4')).toEqual({ street: 'Erfurter Str.', no: 4, suffix: '' })
    expect(parseAddress('c/o Meier\nCarl-Benz-Straße 7-9\n68723 Musterstadt')).toEqual({ street: 'Carl-Benz-Straße', no: 7, suffix: '' })
    expect(parseAddress('Straße des 17. Juni 5')).toEqual({ street: 'Straße des 17. Juni', no: 5, suffix: '' })
    expect(parseAddress('Marktplatz\n68723 Musterstadt')).toEqual({ street: 'Marktplatz', no: null, suffix: '' })
    expect(parseAddress('   ')).toBeNull()
    expect(parseAddress('68723 Musterstadt')).toBeNull()
  })

  it('counts a range inclusive, by side, with suffixes', () => {
    const odd = row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' })
    expect(rowContains(odd, 1, '')).toBe(true)
    expect(rowContains(odd, 3, '')).toBe(true)
    expect(rowContains(odd, 3, 'a')).toBe(true)
    expect(rowContains(odd, 3, 'b')).toBe(false)
    expect(rowContains(odd, 2, '')).toBe(false)
    expect(rowContains(odd, 5, '')).toBe(false)
    // „bis 14“ includes 14a; „ab 4b“ leaves out 4 and 4a.
    expect(rowContains(row('Ahornweg', 2, 14, '04'), 14, 'a')).toBe(true)
    expect(rowContains(row('Ahornweg', 4, 14, '04', { fromSuffix: 'b' }), 4, 'a')).toBe(false)
    expect(rowContains(row('Ahornweg', 4, 14, '04', { fromSuffix: 'b' }), 4, 'c')).toBe(true)
    expect(rowContains(row('Kurze Gasse', 1, 4, '03', { side: 'all' }), 2, '')).toBe(true)
    expect(rowContains(row('Marktplatz', null, null, '02'), 999, '')).toBe(true)
  })
})

describe('matching an address', () => {
  const index = buildDistrictIndex(parseDistrictLines(FIXTURE).rows)

  it('finds the one district of the street, side and number', () => {
    expect(matchAddress(index, 'Ahornweg 12\n68723 Musterstadt')).toEqual({ kind: 'match', code: '04' })
    expect(matchAddress(index, 'Bahnhofanlage 3a')).toEqual({ kind: 'match', code: '02' })
    expect(matchAddress(index, 'Erfurter Str. 10')).toEqual({ kind: 'match', code: '03' })
    expect(matchAddress(index, 'Erfurter Strasse 10')).toEqual({ kind: 'match', code: '03' })
    expect(matchAddress(index, 'Markgrafenstraße 16')).toEqual({ kind: 'match', code: '02' })
  })

  it('says none for a number outside the ranges, the other side, or an unknown street', () => {
    expect(matchAddress(index, 'Ahornweg 40')).toEqual({ kind: 'none' })
    expect(matchAddress(index, 'Erfurter Straße 5')).toEqual({ kind: 'none' })
    expect(matchAddress(index, 'Bahnhofanlage 3b')).toEqual({ kind: 'none' })
    expect(matchAddress(index, 'Gibtsnichtweg 1')).toEqual({ kind: 'none' })
  })

  it('is ambiguous where ranges of different districts overlap', () => {
    expect(matchAddress(index, 'Friedrich-Ebert-Straße 30')).toEqual({ kind: 'ambiguous', codes: ['01', '03'] })
    expect(matchAddress(index, 'Friedrich-Ebert-Straße 10')).toEqual({ kind: 'match', code: '01' })
  })

  it('matches a truncated name of the list as a prefix when it is the only one', () => {
    expect(matchAddress(index, 'Clementine-Bassermann-Straße 5')).toEqual({ kind: 'match', code: '02' })
    expect(matchAddress(index, 'Friedrichsfelder Landstraße 25')).toEqual({ kind: 'match', code: '04' })
    // Two truncated names that both fit: nothing is guessed.
    const two = buildDistrictIndex([row('Clementine-Bassermann-St', 1, 27, '02'), row('Clementine-Bassermann-Str', 1, 27, '03')])
    expect(matchAddress(two, 'Clementine-Bassermann-Straße 5')).toEqual({ kind: 'match', code: '03' })
    const prefixes = buildDistrictIndex([row('Clementine-Bassermann-St', 1, 27, '02'), row('Clementine-Bassermann-Stra', 1, 27, '03')])
    expect(matchAddress(prefixes, 'Clementine-Bassermann-Straße 5')).toEqual({ kind: 'none' })
  })

  it('takes only names that look cut off as a beginning, never a complete name', () => {
    expect(looksTruncated('Clementine-Bassermann-St')).toBe(true)
    expect(looksTruncated('Friedrichsfelder Landstr')).toBe(true)
    expect(looksTruncated('Hockenheimer Landstraße')).toBe(false)
    expect(looksTruncated('Am Alten Rathaus')).toBe(false)
    expect(looksTruncated('Brühler Sträßchen')).toBe(false)
    expect(looksTruncated('Konrad-Adenauer-Platz')).toBe(false)
    const rathaus = buildDistrictIndex([row('Am Alten Rathaus', 1, 9, '01'), row('Clementine-Bassermann-St', 1, 27, '02')])
    expect(matchAddress(rathaus, 'Am Alten Rathausplatz 3')).toEqual({ kind: 'none' })
    expect(matchAddress(rathaus, 'Clementine-Bassermann-Straße 3')).toEqual({ kind: 'match', code: '02' })
  })

  it('reads an address typed on one line with postcode and town', () => {
    expect(parseAddress('Ahornweg 12 68723 Musterstadt')).toEqual({ street: 'Ahornweg', no: 12, suffix: '' })
    expect(parseAddress('Ahornweg 12a · 68723 Musterstadt')).toEqual({ street: 'Ahornweg', no: 12, suffix: 'a' })
    expect(parseAddress('Ahornweg 12 in 68723 Musterstadt')).toEqual({ street: 'Ahornweg', no: 12, suffix: '' })
    expect(parseAddress('Ahornweg 12 D-68723 Musterstadt')).toEqual({ street: 'Ahornweg', no: 12, suffix: '' })
    expect(matchAddress(index, 'Ahornweg 12 68723 Musterstadt')).toEqual({ kind: 'match', code: '04' })
    // Outside the listed range: not in the list, not a confident district by the street alone.
    expect(matchAddress(index, 'Ahornweg 40 68723 Musterstadt')).toEqual({ kind: 'none' })
    const short = buildDistrictIndex([row('Am Rain', 1, 9, '03')])
    expect(matchAddress(short, 'Am Rain 5 68723 Musterstadt')).toEqual({ kind: 'match', code: '03' })
    // Digits that are no house number: the prefix rule is not tried.
    expect(matchAddress(index, 'Clementine-Bassermann-Straße 5 Haus 2 Etage 3')).toEqual({ kind: 'none' })
  })

  it('uses every row of the street without a house number', () => {
    expect(matchAddress(index, 'Ahornweg')).toEqual({ kind: 'match', code: '04' })
    expect(matchAddress(index, 'Friedrich-Ebert-Straße')).toEqual({ kind: 'ambiguous', codes: ['01', '03'] })
  })

  it('has nothing to say without an address', () => {
    expect(matchAddress(index, '')).toEqual({ kind: 'noAddress' })
  })
})
