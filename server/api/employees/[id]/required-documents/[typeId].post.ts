import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../../lib/documentHttp'
import { requiredDocumentParams, requiredDocumentUploadFields } from '../../../../schemas'
import { uploadRequiredDocument } from '../../../../services/requiredDocuments'

/** „Hochladen“ of a Pflichtdokument: into the type's folder (its key, the file checks), linked to the type. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id, typeId } = await getValidatedRouterParams(event, requiredDocumentParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseUploadParts(await readUploadParts(event), requiredDocumentUploadFields)
  return { id: uploadRequiredDocument(useDb(), actor, actor.facilityId, id, typeId, fields, file) }
})
