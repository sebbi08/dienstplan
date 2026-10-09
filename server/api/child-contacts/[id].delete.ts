import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { deleteContact } from '../../services/childContacts'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteContact(useDb(), actor, actor.facilityId, id, todayIso())
  return { ok: true }
})
