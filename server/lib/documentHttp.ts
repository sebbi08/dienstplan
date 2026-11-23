import type { IncomingMessage } from 'node:http'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { ChildDocumentMeta } from '../../shared/types/api'
import { childDocumentFields } from '../schemas'
import { ServiceError } from './errors'
import { MAX_DOCUMENT_BYTES } from './fileSignature'

/** Room for the form fields and multipart boundaries around the file. */
const MULTIPART_OVERHEAD = 64 * 1024

/**
 * Vets the `Content-Length` header of an upload before the body is read into memory: a missing or non-numeric header
 * is 411 length_required, a body larger than the biggest file (`maxBytes`, by default the 30 MB of every document) plus
 * the form overhead 413 `tooLargeCode`.
 */
export function assertUploadLength(header: string | undefined, maxBytes = MAX_DOCUMENT_BYTES, tooLargeCode = 'document_too_large'): void {
  if (header === undefined || !/^\d+$/.test(header.trim())) throw new ServiceError(411, 'length_required')
  if (Number(header) > maxBytes + MULTIPART_OVERHEAD) throw new ServiceError(413, tooLargeCode)
}

/** A part of a multipart body (the shape h3's `readMultipartFormData` returns). */
export interface UploadPart {
  name?: string
  filename?: string
  type?: string
  data: Buffer
}

/** At most this many parts are read from one form; header blocks longer than 16 KB end the reading. */
const MAX_PARTS = 100
const MAX_PART_HEADERS = 16 * 1024

/**
 * The parameters of a Content-Disposition header, read left to right with quoted strings as whole tokens (so
 * `filename="a; name=b"` cannot fake a `name`), decoded like browsers send them (UTF-8 bytes); the first of a name wins.
 */
function dispositionParameters(header: string): Map<string, string> {
  const parameters = new Map<string, string>()
  for (const match of header.matchAll(/;\s*([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g)) {
    const name = match[1]!.toLowerCase()
    const raw = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : (match[3] ?? '').trim()
    if (!parameters.has(name)) parameters.set(name, Buffer.from(raw, 'latin1').toString('utf8'))
  }
  return parameters
}

/**
 * The parts of a multipart/form-data body, found with Buffer.indexOf (linear) and handed out as views into the body –
 * the file is never copied. (h3's own parser collects the bytes one by one in a JS array, which for a 30 MB file costs
 * several hundred MB and seconds.)
 */
export function parseMultipart(body: Buffer, boundary: string): UploadPart[] {
  const delimiter = Buffer.from(`--${boundary}`, 'latin1')
  const next = Buffer.from(`\r\n--${boundary}`, 'latin1')
  const parts: UploadPart[] = []
  let at = body.indexOf(delimiter)
  while (at >= 0 && parts.length < MAX_PARTS) {
    let start = at + delimiter.length
    if (body[start] === 0x2D && body[start + 1] === 0x2D) break
    if (body[start] === 0x0D && body[start + 1] === 0x0A) start += 2
    const headerEnd = body.indexOf('\r\n\r\n', start, 'latin1')
    if (headerEnd < 0 || headerEnd - start > MAX_PART_HEADERS) break
    const end = body.indexOf(next, headerEnd + 4)
    if (end < 0) break
    const headers = body.toString('latin1', start, headerEnd)
    const disposition = dispositionParameters(/^content-disposition:(.*)$/im.exec(headers)?.[1] ?? '')
    const type = /^content-type:\s*(.*)$/im.exec(headers)?.[1]?.trim()
    parts.push({
      name: disposition.get('name'), filename: disposition.get('filename'),
      ...(type ? { type } : {}), data: body.subarray(headerEnd + 4, end),
    })
    at = end + 2
  }
  return parts
}

/**
 * The body of a request read once into a buffer of the announced size, allocated when the first bytes arrive (a client
 * that sends nothing holds nothing); more bytes than announced: 413 `tooLargeCode`.
 */
function readBodyOnce(request: IncomingMessage, length: number, tooLargeCode: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let body: Buffer | null = null
    let filled = 0
    request.on('data', (chunk: Buffer) => {
      body ??= Buffer.allocUnsafe(length)
      if (filled + chunk.length > length) {
        request.removeAllListeners('data')
        request.resume()
        reject(new ServiceError(413, tooLargeCode))
        return
      }
      chunk.copy(body, filled)
      filled += chunk.length
    })
    request.on('end', () => resolve(body ? body.subarray(0, filled) : Buffer.alloc(0)))
    request.on('error', reject)
  })
}

/**
 * The parts of an upload form: Content-Length checked first (411/413, see assertUploadLength), the body read once into
 * one buffer of that size, the parts views into it. So a 30 MB upload costs about 30 MB of memory, not a multiple.
 */
export function readUploadParts(event: Pick<H3Event, 'node'>, maxBytes = MAX_DOCUMENT_BYTES, tooLargeCode = 'document_too_large'): Promise<UploadPart[]> {
  return readUploadPartsFrom(event.node.req, maxBytes, tooLargeCode)
}

/** readUploadParts on the plain Node request (tests drive it with a stream). */
export async function readUploadPartsFrom(request: IncomingMessage, maxBytes = MAX_DOCUMENT_BYTES, tooLargeCode = 'document_too_large'): Promise<UploadPart[]> {
  const header = request.headers['content-length']
  assertUploadLength(header, maxBytes, tooLargeCode)
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(request.headers['content-type'] ?? '')
  if (!boundary) throw new ServiceError(400, 'file_required')
  const body = await readBodyOnce(request, Number(header), tooLargeCode)
  return parseMultipart(body, boundary[1] ?? boundary[2]!)
}

/**
 * The file (400 file_required) and the form fields of a multipart upload, checked with `schema` (400 invalid_input).
 */
export function parseUploadParts<T>(
  parts: UploadPart[], schema: z.ZodType<T>,
): { file: { data: Buffer; filename: string }; fields: T } {
  if (!parts.some(part => part.name === 'file' && part.filename !== undefined)) throw new ServiceError(400, 'file_required')
  const { file, fields } = parseOptionalUploadParts(parts, schema)
  return { file: file!, fields }
}

/** Like parseUploadParts, but the file may be left out (null): e.g. an entry of „Wissen“ that is a link or a text. */
export function parseOptionalUploadParts<T>(
  parts: UploadPart[], schema: z.ZodType<T>,
): { file: { data: Buffer; filename: string } | null; fields: T } {
  const file = parts.find(part => part.name === 'file' && part.filename !== undefined)
  const fields = schema.safeParse(Object.fromEntries(
    parts.filter(part => part.filename === undefined && part.name !== undefined)
      .map(part => [part.name, part.data.toString('utf8')]),
  ))
  if (!fields.success) throw new ServiceError(400, 'invalid_input')
  return { file: file ? { data: file.data, filename: file.filename ?? '' } : null, fields: fields.data }
}

/** The file and the document fields of a child document upload. */
export function parseUploadForm(parts: UploadPart[]): { file: { data: Buffer; filename: string }; meta: ChildDocumentMeta } {
  const { file, fields } = parseUploadParts(parts, childDocumentFields)
  const { typeId, title, documentDate, confidential } = fields
  return { file, meta: { typeId, title, documentDate, confidential } }
}

/**
 * Whether a document file is sent as a download. In the office as asked (`?download=1`). At the tablet (spec §6) only
 * the in-app viewer may fetch the file: never as a download, and a request the browser makes to show the file itself
 * (address bar, link, frame, embed: any `Sec-Fetch-Dest` other than `empty`, which fetch() sends) is refused with 403
 * forbidden, as such a page could land in the downloads. Browsers without the header are let through.
 */
export function documentDownload(viewer: { onTablet: boolean }, downloadAsked: boolean, fetchDest: string | undefined): boolean {
  if (!viewer.onTablet) return downloadAsked
  if (fetchDest !== undefined && fetchDest !== 'empty') throw new ServiceError(403, 'forbidden')
  return false
}

/**
 * Headers of a document download: the stored type, never sniffed (nosniff), never cached, shown in the browser
 * (inline) or saved (attachment). `fileName` is already reduced to letters, digits, dot and dash.
 */
export function documentResponseHeaders(file: { mimeType: string; fileName: string }, download: boolean): Record<string, string> {
  return {
    'Content-Type': file.mimeType,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  }
}

/**
 * Headers of a CSV download (UTF-8, saved as attachment, never cached). The name may hold umlauts: `filename` carries
 * an ASCII fallback, `filename*` the UTF-8 name (RFC 6266).
 */
export function csvResponseHeaders(fileName: string): Record<string, string> {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  }
}
