import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteApplicant } from '../../services/visits'

/** Deletes an applicant with days, documents and forms; the bytes leave the WAL at once. */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteApplicant(useDb(), actor, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
