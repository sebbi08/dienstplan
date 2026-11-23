import { describe, expect, it } from 'vitest'
import { cachedHasFormFields, forgetFormFields, hasFormFields } from '../../server/lib/pdfForm'
import { compressedFillablePdf, fillablePdf, plainPdf, signatureOnlyPdf } from '../helpers/fillablePdf'

describe('fillable PDF detection', () => {
  it('finds a text field and a checkbox in a plain AcroForm', () => {
    expect(hasFormFields(fillablePdf())).toBe(true)
  })

  it('finds fields packed into a compressed object stream', () => {
    expect(hasFormFields(compressedFillablePdf())).toBe(true)
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

  it('remembers the answer per key and stamp, reads the file only when needed, and forgets on request', () => {
    let reads = 0
    const load = () => {
      reads++
      return fillablePdf()
    }
    expect(cachedHasFormFields('test', 1, 'a', load)).toBe(true)
    expect(cachedHasFormFields('test', 1, 'a', load)).toBe(true)
    expect(reads).toBe(1)
    // A new stamp (replaced file) reads again.
    expect(cachedHasFormFields('test', 1, 'b', () => plainPdf())).toBe(false)
    forgetFormFields('test', 1)
    expect(cachedHasFormFields('test', 1, 'b', load)).toBe(true)
    expect(reads).toBe(2)
  })
})
