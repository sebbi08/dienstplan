import { todayIso } from '../../../../shared/domain/dates'
import { childContactSchema, idParams } from '../../../schemas'
import { addContact } from '../../../services/childContacts'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childContactSchema.parse)
  return { id: addContact(useDb(), actor, actor.facilityId, id, body, todayIso()) }
})
