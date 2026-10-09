import { todayIso } from '../../../../shared/domain/dates'
import { childMasterSchema, idParams } from '../../../schemas'
import { updateChildMaster } from '../../../services/children'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childMasterSchema.parse)
  updateChildMaster(useDb(), actor, actor.facilityId, id, body, todayIso())
  return { ok: true }
})
