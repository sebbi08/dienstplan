import { todayIso } from '../../../shared/domain/dates'
import { childContactSchema, idParams } from '../../schemas'
import { updateContact } from '../../services/childContacts'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childContactSchema.parse)
  updateContact(useDb(), actor, actor.facilityId, id, body, todayIso())
  return { ok: true }
})
