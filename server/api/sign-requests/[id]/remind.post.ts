import { idParams, signRequestRecipientSchema } from '../../../schemas'
import { remindSignRequest } from '../../../services/signRequests'

/** „Erinnern“: the open recipients (or one) see the reminder in their list. */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { recipientId } = await readValidatedBody(event, signRequestRecipientSchema.parse)
  return { count: remindSignRequest(useDb(), await withHomeGroup(event, sender), id, recipientId) }
})
