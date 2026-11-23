import { checkpointWal } from '../../../db/client'
import { assertUploadLength, parseUploadParts } from '../../../lib/documentHttp'
import { idParams, noFields } from '../../../schemas'
import { replaceEmployeeDocumentFile } from '../../../services/employeeDocuments'

/** „Weiter ausfüllen“: the filled form replaces the document's PDF; the service checks the folder's key (403). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts((await readMultipartFormData(event)) ?? [], noFields)
  replaceEmployeeDocumentFile(useDb(), actor, actor.facilityId, id, file)
  // The replaced file must not linger in the write-ahead log either.
  checkpointWal(useSqlite())
  return { ok: true }
})
