import { checkpointWal } from '../../../db/client'
import { idParams } from '../../../schemas'
import { deleteIfsgCase } from '../../../services/ifsg'

/** Deletes a case entered by mistake (Leitung and Träger); health data, so the WAL is checkpointed at once. */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteIfsgCase(useDb(), manager, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
