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

/** The file (400 file_required) and the document fields (400 invalid_input) of a multipart upload. */
export function parseUploadForm(parts: UploadPart[]): { file: { data: Buffer; filename: string }; meta: ChildDocumentMeta } {
  const file = parts.find(part => part.name === 'file' && part.filename !== undefined)
  if (!file) throw new ServiceError(400, 'file_required')
  const fields = childDocumentFields.safeParse(Object.fromEntries(
    parts.filter(part => part.filename === undefined && part.name !== undefined)
      .map(part => [part.name, part.data.toString('utf8')]),
  ))
  if (!fields.success) throw new ServiceError(400, 'invalid_input')
  const { typeId, title, documentDate, confidential } = fields.data
  return { file: { data: file.data, filename: file.filename ?? '' }, meta: { typeId, title, documentDate, confidential } }
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
