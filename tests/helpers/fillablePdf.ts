import { deflateSync } from 'node:zlib'

/**
 * Tiny hand-built PDFs for the form tests (no tool, no library): one A6-ish page with a text field „name“ and a checkbox
 * „agreed“ (export value Yes), as a real AcroForm that pdf.js opens, fills and saves.
 */

const FIELD_OBJECTS = [
  '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /Rect [20 150 180 170] /F 4 /DA (/Helv 10 Tf 0 g) /P 3 0 R >>',
  '<< /Type /Annot /Subtype /Widget /FT /Btn /T (agreed) /Rect [20 110 36 126] /F 4 /V /Off /AS /Off /MK << /CA (4) >> '
  + '/AP << /N << /Yes 6 0 R /Off 7 0 R >> >> /P 3 0 R >>',
]

/** Numbered objects (1 …) with a classic cross-reference table and offsets that match. */
function assemble(objects: string[], header = '%PDF-1.7'): Buffer {
  let out = `${header}\n`
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const appearance = (content: string) =>
  `<< /Type /XObject /Subtype /Form /BBox [0 0 16 16] /Length ${content.length} >>\nstream\n${content}\nendstream`

/** A form with one text field and one checkbox. */
export function fillablePdf(): Buffer {
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R] /NeedAppearances true >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R 5 0 R] >>',
    ...FIELD_OBJECTS,
    appearance('0 g 2 2 12 12 re f'),
    appearance(''),
  ])
}

/** The same page without any field: a plain printable PDF. */
export function plainPdf(): Buffer {
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 33 >>\nstream\nBT /F1 12 Tf 20 150 Td (Hallo) Tj ET\nendstream',
  ])
}

/**
 * The fields packed into a compressed object stream (PDF 1.5), as many office programs and Acrobat write them: neither
 * „/AcroForm“'s fields nor „/FT“ are readable in the raw bytes. Only for the detection (no valid cross references).
 */
export function compressedFillablePdf(): Buffer {
  const inner = ['<< /Fields [4 0 R 5 0 R] >>', ...FIELD_OBJECTS]
  let offsets = ''
  let body = ''
  inner.forEach((object, index) => {
    offsets += `${[9, 4, 5][index]} ${body.length} `
    body += `${object}\n`
  })
  const packed = deflateSync(Buffer.from(offsets + body, 'latin1'))
  const head = Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm 9 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R 5 0 R] >>\nendobj\n'
    + `8 0 obj\n<< /Type /ObjStm /N 3 /First ${offsets.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    'latin1',
  )
  return Buffer.concat([head, packed, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')])
}

/** A form whose only field is a signature: nothing to type in. */
export function signatureOnlyPdf(): Buffer {
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
    '<< /Type /Annot /Subtype /Widget /FT /Sig /T (sign) /Rect [20 20 180 60] /F 4 /P 3 0 R >>',
  ])
}
