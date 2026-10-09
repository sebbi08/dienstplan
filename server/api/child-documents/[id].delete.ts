import { todayIso } from '../../../shared/domain/dates'
import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteDocument } from '../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteDocument(useDb(), actor, actor.facilityId, id, todayIso())
  checkpointWal(useSqlite())
  return { ok: true }
})
