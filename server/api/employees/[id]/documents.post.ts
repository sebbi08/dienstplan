import { assertUploadLength, parseUploadParts } from '../../../lib/documentHttp'
import { employeeDocumentSchema, idParams } from '../../../schemas'
import { uploadEmployeeDocument } from '../../../services/employeeDocuments'

/** Upload into a folder of the personnel file; the service checks the folder's key (403) and the file (400/413). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseUploadParts((await readMultipartFormData(event)) ?? [], employeeDocumentSchema)
  return { id: uploadEmployeeDocument(useDb(), actor, actor.facilityId, id, fields, file) }
})
