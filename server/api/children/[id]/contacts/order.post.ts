import { todayIso } from '../../../../../shared/domain/dates'
import { contactOrderSchema, idParams } from '../../../../schemas'
import { reorderContacts } from '../../../../services/childContacts'

export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, contactOrderSchema.parse)
  reorderContacts(useDb(), actor, actor.facilityId, id, body.ids, todayIso())
  return { ok: true }
})
