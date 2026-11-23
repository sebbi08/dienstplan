import { readdirSync, readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  assertUploadLength, documentDownload, documentResponseHeaders, parseMultipart, parseUploadForm, parseUploadParts, readUploadPartsFrom,
  type UploadPart,
} from '../../server/lib/documentHttp'
import { noFields, printTemplateFields } from '../../server/schemas'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import { MAX_UPLOAD_BYTES } from '../../shared/domain/uploads'
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

describe('documentDownload', () => {
  const office = { onTablet: false }
  const tablet = { onTablet: true }

  it('follows ?download=1 in the office, whatever the browser fetches the file for', () => {
    expect(documentDownload(office, true, 'document')).toBe(true)
    expect(documentDownload(office, false, 'document')).toBe(false)
    expect(documentDownload(office, false, undefined)).toBe(false)
  })

  it('never sends a download at the tablet, also when asked for one', () => {
    expect(documentDownload(tablet, true, 'empty')).toBe(false)
    expect(documentDownload(tablet, true, undefined)).toBe(false)
  })

  it('refuses at the tablet to open the file as a page, in a frame or an embed', () => {
    for (const dest of ['document', 'iframe', 'frame', 'embed', 'object']) {
      expect(errorCode(() => documentDownload(tablet, false, dest))).toBe('forbidden')
    }
    expect(errorCode(() => documentDownload(tablet, true, 'document'))).toBe('forbidden')
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

  it('is 30 MB for every document, and takes a lower limit with its own code (the street list)', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(MAX_UPLOAD_BYTES)
    expect(MAX_UPLOAD_BYTES).toBe(30 * 1024 * 1024)
    const ten = 10 * 1024 * 1024
    expect(() => assertUploadLength(String(ten + 64 * 1024), ten, 'school_district_file_too_large')).not.toThrow()
    expect(errorCode(() => assertUploadLength(String(ten + 64 * 1024 + 1), ten, 'school_district_file_too_large'))).toBe('school_district_file_too_large')
  })
})

/** A multipart body as a browser sends it: fields and one file. */
function multipartBody(boundary: string, file: Buffer, filename = 'Vertrag.pdf', fields: Record<string, string> = {}): Buffer {
  return Buffer.concat([
    ...Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8')),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ])
}

/** A request stream with the headers of a multipart upload of `body` (the length can be announced differently). */
function request(body: Buffer, boundary: string, announced = body.length): IncomingMessage {
  const stream = Readable.from((function* () {
    for (let at = 0; at < body.length; at += 64 * 1024) yield body.subarray(at, at + 64 * 1024)
  })()) as unknown as IncomingMessage
  stream.headers = { 'content-length': String(announced), 'content-type': `multipart/form-data; boundary=${boundary}` }
  return stream
}

describe('reading an upload body', () => {
  const boundary = '----WebKitFormBoundaryAbC123'

  it('finds fields and the file, decodes UTF-8 names and keeps the bytes exact', () => {
    const file = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('\r\n--not the boundary\r\n'), Buffer.alloc(1000, 0xFF)])
    const parts = parseMultipart(multipartBody(boundary, file, 'Einverständnis Müller.pdf', { title: 'Grüße', typeId: '3' }), boundary)
    expect(parts.map(part => [part.name, part.filename, part.type])).toEqual([
      ['title', undefined, undefined], ['typeId', undefined, undefined], ['file', 'Einverständnis Müller.pdf', 'application/pdf'],
    ])
    expect(parts[0]!.data.toString('utf8')).toBe('Grüße')
    expect(parts[2]!.data.equals(file)).toBe(true)
    // A body without the boundary, or cut off before the closing boundary, has no (further) parts.
    expect(parseMultipart(Buffer.from('nothing'), boundary)).toEqual([])
    expect(parseMultipart(multipartBody(boundary, file).subarray(0, 300), boundary)).toEqual([])
  })

  it('reads the parameters with quoted strings as whole tokens', () => {
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; filename="x; name=evil.pdf"; name="file"\r\n\r\nabc\r\n--${boundary}--\r\n`, 'latin1')
    expect(parseMultipart(body, boundary).map(part => [part.name, part.filename])).toEqual([['file', 'x; name=evil.pdf']])
    const escaped = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a\\"b.pdf"\r\n\r\nabc\r\n--${boundary}--\r\n`, 'latin1')
    expect(parseMultipart(escaped, boundary)[0]!.filename).toBe('a"b.pdf')
  })

  it('reads at most 100 parts and header blocks of at most 16 KB', () => {
    const field = (index: number) => `--${boundary}\r\nContent-Disposition: form-data; name="f${index}"\r\n\r\n${index}\r\n`
    const many = Buffer.from(`${Array.from({ length: 150 }, (_, index) => field(index)).join('')}--${boundary}--\r\n`, 'latin1')
    const parts = parseMultipart(many, boundary)
    expect(parts).toHaveLength(100)
    expect(parts.at(-1)!.name).toBe('f99')
    const longHeaders = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\nX-Pad: ${'a'.repeat(17 * 1024)}\r\n\r\nabc\r\n--${boundary}--\r\n`, 'latin1')
    expect(parseMultipart(longHeaders, boundary)).toEqual([])
    const fitting = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\nX-Pad: ${'a'.repeat(15 * 1024)}\r\n\r\nabc\r\n--${boundary}--\r\n`, 'latin1')
    expect(parseMultipart(fitting, boundary).map(part => part.data.toString())).toEqual(['abc'])
  })

  it('reads a 30 MB upload once: the file is a view into the one body buffer, fast', async () => {
    const file = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_DOCUMENT_BYTES - 9, 0x41)])
    const body = multipartBody(boundary, file)
    const started = performance.now()
    const parts = await readUploadPartsFrom(request(body, boundary))
    expect(performance.now() - started).toBeLessThan(1000)
    const { file: read } = parseUploadParts(parts, noFields)
    expect(read.data.length).toBe(MAX_DOCUMENT_BYTES)
    // No copy: the file shares the memory of the request body.
    expect(read.data.buffer.byteLength).toBeLessThan(MAX_DOCUMENT_BYTES + 64 * 1024)
    expect(parts.every(part => part.data.buffer === read.data.buffer)).toBe(true)
  })

  it('refuses a body larger than announced or announced too large, before keeping it', async () => {
    const body = multipartBody(boundary, Buffer.from('%PDF-1.7\nsmall'))
    await expect(readUploadPartsFrom(request(body, boundary, body.length - 5))).rejects.toMatchObject({ code: 'document_too_large' })
    await expect(readUploadPartsFrom(request(body, boundary, LIMIT + 1))).rejects.toMatchObject({ code: 'document_too_large' })
    const missing = request(body, boundary)
    missing.headers = { 'content-type': missing.headers['content-type'] }
    await expect(readUploadPartsFrom(missing)).rejects.toMatchObject({ code: 'length_required' })
    const noBoundary = request(body, boundary)
    noBoundary.headers['content-type'] = 'multipart/form-data'
    await expect(readUploadPartsFrom(noBoundary)).rejects.toMatchObject({ code: 'file_required' })
  })

  it('is the only way the upload routes read their body, always after the length check', () => {
    const api = join(process.cwd(), 'server', 'api')
    const files = (readdirSync(api, { recursive: true }) as string[]).filter(file => file.endsWith('.ts'))
      .map(file => ({ file, code: readFileSync(join(api, file), 'utf8') }))
    const uploads = files.filter(({ code }) => code.includes('readUploadParts('))
    expect(uploads.length).toBeGreaterThanOrEqual(14)
    for (const { file, code } of files) expect(code, file).not.toContain('readMultipartFormData')
    for (const { file, code } of uploads) expect(code.indexOf('assertUploadLength('), file).toBeLessThan(code.indexOf('readUploadParts(event'))
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

describe('parseUploadParts for print templates', () => {
  const text = (name: string, value: string): UploadPart => ({ name, data: Buffer.from(value) })
  const file: UploadPart = { name: 'file', filename: 'Elternbrief.pdf', data: Buffer.from('%PDF-1.7') }
  const parse = (parts: UploadPart[]) => parseUploadParts(parts, printTemplateFields)

  it('reads title, category and scope, the facility being the default scope', () => {
    expect(parse([file, text('title', 'Brief'), text('categoryId', '3'), text('scope', 'all')]).fields)
      .toEqual({ title: 'Brief', categoryId: 3, scope: 'all' })
    expect(parse([file, text('title', 'Brief'), text('categoryId', '3')]).fields.scope).toBe('facility')
  })

  it('reads the category name and visibility of a template for all facilities', () => {
    expect(parse([file, text('title', 'Brief'), text('categoryName', 'Personal'), text('visibility', 'managers'), text('scope', 'all')]).fields)
      .toEqual({ title: 'Brief', categoryName: 'Personal', visibility: 'managers', scope: 'all' })
    expect(errorCode(() => parse([file, text('title', 'Brief'), text('categoryName', 'x'.repeat(61))]))).toBe('invalid_input')
    expect(errorCode(() => parse([file, text('title', 'Brief'), text('visibility', 'everyone')]))).toBe('invalid_input')
  })

  it('needs the file and well-formed fields (which category is missing, the service says)', () => {
    expect(errorCode(() => parse([text('title', 'Brief'), text('categoryId', '3')]))).toBe('file_required')
    expect(errorCode(() => parse([file, text('title', 'Brief'), text('categoryId', '3'), text('scope', 'mine')]))).toBe('invalid_input')
    expect(errorCode(() => parse([file, text('title', 'x'.repeat(201)), text('categoryId', '3')]))).toBe('invalid_input')
    expect(parse([file, text('title', 'Brief')]).fields).toEqual({ title: 'Brief', scope: 'facility' })
    expect(errorCode(() => parse([file, text('title', 'Brief'), text('categoryId', '')]))).toBe('invalid_input')
    expect(errorCode(() => parse([file, text('title', 'Brief'), text('categoryId', 'Eltern')]))).toBe('invalid_input')
    expect(parseUploadParts([file], noFields).file.filename).toBe('Elternbrief.pdf')
  })
})
