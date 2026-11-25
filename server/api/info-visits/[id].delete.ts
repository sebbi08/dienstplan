import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteInfoVisit } from '../../services/visits'

/** Deletes an info visit with its documents and forms; the bytes leave the WAL at once. */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteInfoVisit(useDb(), actor, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
