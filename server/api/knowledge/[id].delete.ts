import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteKnowledgeEntry } from '../../services/knowledge'

/** Deletes an entry with its read confirmations. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'knowledge.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteKnowledgeEntry(useDb(), await withHomeGroup(event, editor), id)
  // Like a deleted document: the file and the confirmations must not linger in the write-ahead log.
  checkpointWal(useSqlite())
  return { ok: true }
})
