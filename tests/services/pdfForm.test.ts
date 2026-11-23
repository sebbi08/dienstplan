import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fillableFile, hasFormFields } from '../../server/lib/pdfForm'
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

    it('many object streams (more than may be looked at)', () => {
      const small = Buffer.from('1 0 << /A 1 >>\n', 'latin1')
      const many = Buffer.concat([header, ...Array.from({ length: 600 }, (_, index) => objectStream(index + 1, small)),
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
