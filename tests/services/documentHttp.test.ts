import { describe, expect, it } from 'vitest'
import { assertUploadLength, documentResponseHeaders, parseUploadForm, type UploadPart } from '../../server/lib/documentHttp'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import { errorCode } from '../helpers/fixtures'

const LIMIT = MAX_DOCUMENT_BYTES + 64 * 1024

describe('documentResponseHeaders', () => {
  const file = { mimeType: 'image/png', fileName: 'Betreuungsvertrag-Mueller-2026-09-01.png' }

  it('serves the stored type inline with nosniff and no caching', () => {
    expect(documentResponseHeaders(file, false)).toEqual({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="Betreuungsvertrag-Mueller-2026-09-01.png"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
  })

  it('forces a download as an attachment', () => {
    const headers = documentResponseHeaders(file, true)
    expect(headers['Content-Disposition']).toBe('attachment; filename="Betreuungsvertrag-Mueller-2026-09-01.png"')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Cache-Control']).toBe('no-store')
  })
})

describe('assertUploadLength', () => {
  it('lets a body up to the limit through', () => {
    expect(() => assertUploadLength(String(LIMIT))).not.toThrow()
    expect(() => assertUploadLength('1234')).not.toThrow()
  })

  it('rejects a bigger body with 413 document_too_large', () => {
    expect(errorCode(() => assertUploadLength(String(LIMIT + 1)))).toBe('document_too_large')
  })

  it('demands a numeric length: 411 length_required', () => {
    for (const header of [undefined, '', 'abc', '-5', '12.5', '1e9']) {
      expect(errorCode(() => assertUploadLength(header)), String(header)).toBe('length_required')
    }
  })
})

describe('parseUploadForm', () => {
  const text = (name: string, value: string): UploadPart => ({ name, data: Buffer.from(value) })
  const file: UploadPart = { name: 'file', filename: 'scan.pdf', data: Buffer.from('%PDF-1.7') }
  const fields = () => [
    text('typeId', '3'), text('title', 'Vertrag'), text('documentDate', '2026-09-01'), text('confidential', 'true'),
  ]

  it('reads the file and the typed fields', () => {
    const { file: parsed, meta } = parseUploadForm([file, ...fields()])
    expect(parsed.filename).toBe('scan.pdf')
    expect(parsed.data.equals(file.data)).toBe(true)
    expect(meta).toEqual({ typeId: 3, title: 'Vertrag', documentDate: '2026-09-01', confidential: true })
    expect(parseUploadForm([...fields().slice(0, 3), text('confidential', 'false'), file]).meta.confidential).toBe(false)
  })

  it('needs the file part: 400 file_required', () => {
    expect(errorCode(() => parseUploadForm(fields()))).toBe('file_required')
    // a text field called "file" is not a file
    expect(errorCode(() => parseUploadForm([text('file', 'x'), ...fields()]))).toBe('file_required')
  })

  it('rejects missing or malformed fields: 400 invalid_input', () => {
    const without = (name: string) => [file, ...fields().filter(part => part.name !== name)]
    for (const name of ['typeId', 'title', 'documentDate', 'confidential']) {
      expect(errorCode(() => parseUploadForm(without(name))), name).toBe('invalid_input')
    }
    const replaced = (name: string, value: string) => [file, ...fields().filter(part => part.name !== name), text(name, value)]
    expect(errorCode(() => parseUploadForm(replaced('confidential', 'yes')))).toBe('invalid_input')
    expect(errorCode(() => parseUploadForm(replaced('documentDate', '2026-02-30')))).toBe('invalid_input')
    expect(errorCode(() => parseUploadForm(replaced('typeId', 'abc')))).toBe('invalid_input')
    expect(errorCode(() => parseUploadForm(replaced('title', 'x'.repeat(201))))).toBe('invalid_input')
  })
})
