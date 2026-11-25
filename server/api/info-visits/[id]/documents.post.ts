import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../lib/documentHttp'
import { idParams, visitDocumentFields } from '../../../schemas'
import { uploadVisitDocument } from '../../../services/visits'

/** A document of the info visit (also a PDF filled in the app); the service checks the file (400/413). */
export default defineServiceHandler(async (event): Promise<{ id: number }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseUploadParts(await readUploadParts(event), visitDocumentFields)
  return { id: uploadVisitDocument(useDb(), actor, 'info', id, fields.title, file) }
})
