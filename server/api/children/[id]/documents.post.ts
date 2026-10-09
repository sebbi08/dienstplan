import { todayIso } from '../../../../shared/domain/dates'
import { MAX_DOCUMENT_BYTES } from '../../../lib/fileSignature'
import { childDocumentFields, idParams } from '../../../schemas'
import { uploadDocument } from '../../../services/childDocuments'

/** Room for the form fields and multipart boundaries around the file. */
const MULTIPART_OVERHEAD = 64 * 1024

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory; a request that does not state its length cannot be vetted this way.
  const length = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isFinite(length) || length > MAX_DOCUMENT_BYTES + MULTIPART_OVERHEAD) {
    throw createError({ statusCode: 413, statusMessage: 'document_too_large', data: { code: 'document_too_large' } })
  }
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(part => part.name === 'file' && part.filename !== undefined)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'file_required', data: { code: 'file_required' } })
  const parsed = childDocumentFields.safeParse(Object.fromEntries(
    parts.filter(part => part.filename === undefined && part.name !== undefined)
      .map(part => [part.name, part.data.toString('utf8')]),
  ))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid_input', data: { code: 'invalid_input' } })
  const fields = parsed.data
  const documentId = uploadDocument(
    useDb(), actor, actor.facilityId, id,
    { typeId: fields.typeId, title: fields.title, documentDate: fields.documentDate, confidential: fields.confidential },
    { data: file.data, filename: file.filename ?? '' }, todayIso(),
  )
  return { id: documentId }
})
