import { todayIso } from '../../../../shared/domain/dates'
import { childHealthSchema, idParams } from '../../../schemas'
import { updateChildHealth } from '../../../services/children'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childHealthSchema.parse)
  updateChildHealth(useDb(), actor, actor.facilityId, id, body, todayIso())
  return { ok: true }
})
