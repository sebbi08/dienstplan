import { todayIso } from '../../../../shared/domain/dates'
import { checkpointWal } from '../../../db/client'
import { assertUploadLength, parseUploadParts } from '../../../lib/documentHttp'
import { idParams, noFields } from '../../../schemas'
import { replaceDocumentFile } from '../../../services/childDocuments'

/** „Bearbeiten“ of a PDF: the filled copy replaces the document's PDF, with the rights of changing the document. */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts((await readMultipartFormData(event)) ?? [], noFields)
  replaceDocumentFile(useDb(), actor, actor.facilityId, id, file, todayIso())
  // The replaced file must not linger in the write-ahead log either.
  checkpointWal(useSqlite())
  return { ok: true }
})
