import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteChild } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteChild(useDb(), manager.facilityId, id)
  checkpointWal(useSqlite())
  return { ok: true }
})
