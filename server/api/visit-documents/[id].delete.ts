import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteVisitDocument } from '../../services/visits'

/** Deletes a document of an open visit; the bytes leave the WAL at once. */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteVisitDocument(useDb(), actor, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
