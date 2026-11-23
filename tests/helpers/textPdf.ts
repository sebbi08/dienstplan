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
