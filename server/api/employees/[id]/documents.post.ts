import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../lib/documentHttp'
import { employeeDocumentUploadSchema, idParams } from '../../../schemas'
import { uploadEmployeeDocument } from '../../../services/employeeDocuments'
import { uploadRequiredDocument } from '../../../services/requiredDocuments'

/**
 * Upload into a folder of the personnel file; the service checks the folder's key (403) and the file (400/413). With
 * a Pflichtdokument („Ausfüllen“ in its box) the copy is linked to it in the same request (its folder must be the type's).
 */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseUploadParts(await readUploadParts(event), employeeDocumentUploadSchema)
  const { requiredTypeId, ...meta } = fields
  return {
    id: requiredTypeId === null
      ? uploadEmployeeDocument(useDb(), actor, actor.facilityId, id, meta, file)
      : uploadRequiredDocument(useDb(), actor, actor.facilityId, id, requiredTypeId, meta, file),
  }
})
