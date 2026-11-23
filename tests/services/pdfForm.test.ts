import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import { fillableFile, hasFormFields, SCAN_LIMITS } from '../../server/lib/pdfForm'
import { compressedFillablePdf, fillablePdf, plainPdf, signatureOnlyPdf } from '../helpers/fillablePdf'

const header = Buffer.from('%PDF-1.7\n', 'latin1')
/** An object stream around `content` (deflated), with its dictionary as a PDF writer puts it. */
const objectStream = (number: number, content: Buffer) => {
  const packed = deflateSync(content)
  return Buffer.concat([
    Buffer.from(`${number} 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, 'latin1'),
    packed,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
}
/** Runs the check and returns its answer and how long it took. */
const timed = (data: Buffer) => {
  const started = performance.now()
  const answer = hasFormFields(data)
  return { answer, ms: performance.now() - started }
}

describe('fillable PDF detection', () => {
  it('finds a text field and a checkbox in a plain AcroForm', () => {
    expect(hasFormFields(fillablePdf())).toBe(true)
  })

  it('finds fields packed into a compressed object stream, also with an indirect stream length', () => {
    expect(hasFormFields(compressedFillablePdf())).toBe(true)
    expect(hasFormFields(compressedFillablePdf({ indirectLength: true }))).toBe(true)
  })

  it('a PDF without fields, one with only a signature field, and no PDF at all are not fillable', () => {
    expect(hasFormFields(plainPdf())).toBe(false)
    expect(hasFormFields(signatureOnlyPdf())).toBe(false)
    expect(hasFormFields(Buffer.from('%PDF-1.7\n'))).toBe(false)
    expect(hasFormFields(Buffer.from([0x89, 0x50, 0x4E, 0x47]))).toBe(false)
  })

  it('field types without an /AcroForm in the catalog do not count', () => {
    const orphan = Buffer.from(plainPdf().toString('latin1').replace('/Contents 4 0 R', '/Contents 4 0 R /X << /FT /Tx >>'), 'latin1')
    expect(hasFormFields(orphan)).toBe(false)
  })

  it('a broken object stream is skipped instead of failing', () => {
    const broken = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length 5 >>\nstream\nxxxxx\nendstream\nendobj\n', 'latin1')
    expect(hasFormFields(broken)).toBe(false)
  })

  it('only PDFs are judged when a file is stored', () => {
    expect(fillableFile(fillablePdf(), 'application/pdf')).toBe(true)
    expect(fillableFile(fillablePdf(), 'image/png')).toBe(false)
  })

  it('judges a benign 25 MB PDF (a form plus a large image) quickly, with the fields before or after the image', () => {
    const image = Buffer.concat([
      Buffer.from('20 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length 26214400 >>\nstream\n', 'latin1'),
      randomBytes(25 * 1024 * 1024), Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ])
    for (const base of [fillablePdf(), compressedFillablePdf()]) {
      for (const pdf of [Buffer.concat([base.subarray(0, 9), image, base.subarray(9)]), Buffer.concat([base, image])]) {
        expect(pdf.length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES)
        const { answer, ms } = timed(pdf)
        expect(answer).toBe(true)
        expect(ms).toBeLessThan(SCAN_LIMITS.budgetMs)
      }
    }
  })

  describe('hostile files finish fast and count as not fillable', () => {
    it('a long run of digits', () => {
      const { answer, ms } = timed(Buffer.concat([header, Buffer.alloc(2 * 1024 * 1024, '7')]))
      expect(answer).toBe(false)
      expect(ms).toBeLessThan(500)
    })

    it('object headers without streams, and object stream names without dictionaries', () => {
      expect(timed(Buffer.concat([header, Buffer.from('1 0 obj '.repeat(250_000), 'latin1')])).ms).toBeLessThan(500)
      const names = timed(Buffer.concat([header, Buffer.from('/ObjStm '.repeat(250_000), 'latin1')]))
      expect(names.answer).toBe(false)
      expect(names.ms).toBeLessThan(500)
    })

    // The time limit is 500 ms (SCAN_LIMITS, tuned for 30 MB uploads); a stop by the clock may take a little longer.
    it('a file full of `obj` before an object stream name stops within the time limit', () => {
      const { answer, ms } = timed(Buffer.concat([header, Buffer.from('obj '.repeat(2_500_000), 'latin1'),
        Buffer.from('/Type /ObjStm /Length 1 stream\nx', 'latin1')]))
      expect(answer).toBe(false)
      expect(ms).toBeLessThan(700)
    })

    it('many object streams (more than the 1000 that may be looked at)', () => {
      const small = Buffer.from('1 0 << /A 1 >>\n', 'latin1')
      const many = Buffer.concat([header, ...Array.from({ length: 1100 }, (_, index) => objectStream(index + 1, small)),
        // The fields would only come after all of them.
        objectStream(9999, Buffer.from('9 0 << /AcroForm << >> /FT /Tx >>', 'latin1'))])
      const { answer, ms } = timed(many)
      expect(answer).toBe(false)
      expect(ms).toBeLessThan(500)
    })

    it('an object stream that inflates beyond the limit', () => {
      const bomb = Buffer.concat([header, Buffer.from('/AcroForm ', 'latin1'), objectStream(1, Buffer.concat([
        Buffer.alloc(8 * 1024 * 1024, 0x20), Buffer.from('/FT /Tx', 'latin1'),
      ]))])
      const { answer, ms } = timed(bomb)
      expect(answer).toBe(false)
      expect(ms).toBeLessThan(500)
    })

    it('many object streams that each inflate beyond the limit', () => {
      const one = objectStream(1, Buffer.alloc(5 * 1024 * 1024, 0x20))
      const bombs = Buffer.concat([header, ...Array.from({ length: 50 }, () => one)])
      const { answer, ms } = timed(bombs)
      expect(answer).toBe(false)
      expect(ms).toBeLessThan(500)
    })
  })
})
