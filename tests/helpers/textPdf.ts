import { deflateRawSync, deflateSync } from 'node:zlib'

/** A text item placed on a page: left edge and baseline in PDF points (origin bottom left). */
export interface PdfText { text: string; x: number; y: number }

/** A literal PDF string in WinAnsi (Latin-1 for the German letters), with ( ) \ and non-ASCII escaped. */
function pdfString(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`
    else if (code < 32 || code > 126) out += `\\${(code & 0xFF).toString(8).padStart(3, '0')}`
    else out += char
  }
  return `(${out})`
}

/**
 * A small hand-built PDF (A4 pages, Helvetica 10 pt, plain content streams, a correct xref table) with the given text
 * items per page, like a street list exported from a spreadsheet. An empty page list item gives a page without text.
 */
export function textPdf(pages: readonly (readonly PdfText[])[]): Buffer {
  const objects: string[] = []
  const pageIds = pages.map((_, index) => 4 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  pages.forEach((items, index) => {
    const content = items.map(item => `BT /F1 10 Tf 1 0 0 1 ${item.x} ${item.y} Tm ${pdfString(item.text)} Tj ET`).join('\n')
    const pageId = pageIds[index]!
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  })
  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1')
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/**
 * A decompression bomb: one page whose content stream (a line of text followed by `megabytes` of spaces) is Flate
 * compressed to about a thousandth of that.
 */
export function flateBombPdf(megabytes: number): Buffer {
  const content = Buffer.concat([Buffer.from('BT /F1 12 Tf 10 10 Td (Ahornweg 2- 14 04) Tj ET\n'), Buffer.alloc(megabytes * 1024 * 1024, 0x20)])
  const deflated = deflateSync(content, { level: 9 })
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`), deflated, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')]
  const offsets: number[] = []
  let length = parts[0]!.length
  objects.forEach((object, index) => {
    offsets.push(length)
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    parts.push(part)
    length += part.length
  })
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(parts)
}

/**
 * A bomb that hides behind a fake `endstream`: the content stream's length is an indirect reference, and its deflate
 * data starts with a stored block holding the bytes „endstream“, followed by `megabytes` of compressed zeros. A check
 * that stops at the first `endstream` sees only the harmless start.
 */
export function fakeEndstreamBombPdf(megabytes: number): Buffer {
  const hidden = Buffer.from('\nendstream\nendobj\n', 'latin1')
  const stored = Buffer.concat([Buffer.from([0x00, hidden.length & 0xFF, hidden.length >> 8, ~hidden.length & 0xFF, (~hidden.length >> 8) & 0xFF]), hidden])
  const data = Buffer.concat([Buffer.from([0x78, 0x01]), stored, deflateRawSync(Buffer.alloc(megabytes * 1024 * 1024), { level: 9 }), Buffer.from([0, 0, 0, 0])])
  const head = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n'
    + '4 0 obj\n<< /Length 5 0 R /Filter /FlateDecode >>\nstream\n', 'latin1')
  const tail = Buffer.from(`\nendstream\nendobj\n5 0 obj\n${data.length}\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1')
  return Buffer.concat([head, data, tail])
}

const pageHead = (contents: string) => '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
  + `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${contents} >>\nendobj\n`
const latin1 = (text: string) => Buffer.from(text, 'latin1')

/**
 * A bomb (`megabytes` of compressed zeros, indirect /Length) that a check positioning by untrusted data would skip:
 * `longLength` – an earlier stream whose direct /Length runs over the bomb object; `stringWord` – the word „stream“ in
 * a string right before it.
 */
export function hiddenBombPdf(kind: 'longLength' | 'stringWord', megabytes: number): Buffer {
  const bomb = deflateSync(Buffer.alloc(megabytes * 1024 * 1024), { level: 9 })
  const bombObject = Buffer.concat([latin1('4 0 obj\n<< /Length 5 0 R /Filter /FlateDecode >>\nstream\n'), bomb, latin1('\nendstream\nendobj\n')])
  const tail = latin1(`5 0 obj\n${bomb.length}\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`)
  if (kind === 'stringWord') return Buffer.concat([latin1(`${pageHead('4 0 R')}6 0 obj\n(xstream)\nendobj\n`), bombObject, tail])
  const inner = Buffer.concat([latin1('x\nendstream\nendobj\n'), bombObject])
  return Buffer.concat([latin1(`${pageHead('4 0 R')}6 0 obj\n<< /Length ${inner.length} >>\nstream\n`), inner, tail])
}

/**
 * Deflate data chained through the whole file: each stream's data runs on through every later stream (empty fixed
 * blocks produce nothing; the next dictionary sits in a stored block), so inflating each stream to the end of its
 * data reads the file again and again.
 */
export function chainedDeflatePdf(streams = 1000, fillerPatterns = 1900): Buffer {
  const filler = Buffer.alloc(fillerPatterns * 5)
  for (let at = 0; at < filler.length; at += 5) filler.set([0x02, 0x08, 0x20, 0x80, 0x00], at)
  const stored = (payload: Buffer) => Buffer.concat([Buffer.from([0x00, payload.length & 0xFF, payload.length >> 8, ~payload.length & 0xFF, (~payload.length >> 8) & 0xFF]), payload])
  const parts = [latin1(pageHead('8 0 R')), latin1('10 0 obj\n<< /Length 1 /Filter /FlateDecode >>\nstream\n'), Buffer.from([0x78, 0x01]), filler]
  for (let index = 1; index < streams; index++) {
    parts.push(stored(Buffer.concat([latin1(`\nendstream\nendobj\n${10 + index} 0 obj\n<< /Length 1 /Filter /FlateDecode >>\nstream\n`), Buffer.from([0x78, 0x01])])), filler)
  }
  parts.push(stored(latin1('\nendstream\nendobj\n8 0 obj\n<< /Length 5 >>\nstream\nBT ET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')))
  return Buffer.concat(parts)
}

/** The street list as a PDF: the three columns at the x positions of the real list, one row every 15 points. */
export function streetListPdf(lines: readonly (readonly string[])[], perPage = 40): Buffer {
  const columns = [53, 205, 348]
  const pages: PdfText[][] = []
  lines.forEach((cells, index) => {
    if (index % perPage === 0) pages.push([])
    const y = 773 - (index % perPage) * 15
    // A legend line (one cell) sits further right, like the real one.
    const items = cells.length === 1 ? [{ text: cells[0]!, x: 103, y }] : cells.map((text, column) => ({ text, x: columns[column]!, y }))
    pages.at(-1)!.push(...items.filter(item => item.text !== ''))
  })
  return textPdf(pages)
}
