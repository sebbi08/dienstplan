import { checkpointWal } from '../../../db/client'
import { assertUploadLength, parseUploadParts } from '../../../lib/documentHttp'
import { idParams, noFields } from '../../../schemas'
import { replaceTemplateFile } from '../../../services/printTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file } = parseUploadParts((await readMultipartFormData(event)) ?? [], noFields)
  replaceTemplateFile(useDb(), admin, id, file)
  // The replaced file must not linger in the write-ahead log either.
  checkpointWal(useSqlite())
  return { ok: true }
})
