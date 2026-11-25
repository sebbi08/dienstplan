import { checkpointWal } from '../../../db/client'
import { assertUploadLength, parseUploadParts, readUploadParts } from '../../../lib/documentHttp'
import { idParams, noFields } from '../../../schemas'
import { replaceVisitDocumentFile } from '../../../services/visits'

/** „Bearbeiten“: the PDF filled further replaces the document's file (PDF only); the old bytes leave the WAL. */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts(await readUploadParts(event), noFields)
  replaceVisitDocumentFile(useDb(), actor, id, file)
  checkpointWal(useSqlite())
  return { ok: true }
})
