import { checkpointWal } from '../../db/client'
import { assertUploadLength, parseOptionalUploadParts, readUploadParts } from '../../lib/documentHttp'
import { idParams, knowledgeEntryFields } from '../../schemas'
import { updateKnowledgeEntry } from '../../services/knowledge'

/** Changes an entry (multipart like creating; without `file` a file entry keeps its PDF). */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // Reject before the body is read into memory.
  assertUploadLength(getRequestHeader(event, 'content-length'))
  const { file, fields } = parseOptionalUploadParts(await readUploadParts(event), knowledgeEntryFields)
  updateKnowledgeEntry(useDb(), await withHomeGroup(event, editor), id, fields, file)
  // A replaced file must not linger in the write-ahead log.
  checkpointWal(useSqlite())
  return { ok: true }
})
