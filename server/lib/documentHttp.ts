import type { z } from 'zod'
import type { ChildDocumentMeta } from '../../shared/types/api'
import { childDocumentFields } from '../schemas'
import { ServiceError } from './errors'
import { MAX_DOCUMENT_BYTES } from './fileSignature'

/** Room for the form fields and multipart boundaries around the file. */
const MULTIPART_OVERHEAD = 64 * 1024

/**
 * Vets the `Content-Length` header of an upload before the body is read into memory: a missing or non-numeric header
 * is 411 length_required, a body larger than the biggest document plus the form overhead 413 document_too_large.
 */
export function assertUploadLength(header: string | undefined): void {
  if (header === undefined || !/^\d+$/.test(header.trim())) throw new ServiceError(411, 'length_required')
  if (Number(header) > MAX_DOCUMENT_BYTES + MULTIPART_OVERHEAD) throw new ServiceError(413, 'document_too_large')
}

/** A part of a multipart body (the shape h3's `readMultipartFormData` returns). */
export interface UploadPart {
  name?: string
  filename?: string
  data: Buffer
}

/**
 * The file (400 file_required) and the form fields of a multipart upload, checked with `schema` (400 invalid_input).
 */
export function parseUploadParts<T>(
  parts: UploadPart[], schema: z.ZodType<T>,
): { file: { data: Buffer; filename: string }; fields: T } {
  const file = parts.find(part => part.name === 'file' && part.filename !== undefined)
  if (!file) throw new ServiceError(400, 'file_required')
  const fields = schema.safeParse(Object.fromEntries(
    parts.filter(part => part.filename === undefined && part.name !== undefined)
      .map(part => [part.name, part.data.toString('utf8')]),
  ))
  if (!fields.success) throw new ServiceError(400, 'invalid_input')
  return { file: { data: file.data, filename: file.filename ?? '' }, fields: fields.data }
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
