import { todayIso } from '../../../shared/domain/dates'
import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteChildRecord } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // An archived record only the Träger deletes (spec Löschübersicht §1).
  deleteChildRecord(useDb(), manager, manager.facilityId, id, todayIso())
  checkpointWal(useSqlite())
  return { ok: true }
})
