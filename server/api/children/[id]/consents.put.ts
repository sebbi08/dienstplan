import { todayIso } from '../../../../shared/domain/dates'
import { childConsentsSchema, idParams } from '../../../schemas'
import { updateChildConsents } from '../../../services/children'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childConsentsSchema.parse)
  updateChildConsents(useDb(), actor, actor.facilityId, id, body, todayIso())
  return { ok: true }
})
