import { idParams, signRequestRecipientSchema } from '../../../schemas'
import { withdrawSignRequest } from '../../../services/signRequests'

/** „Zurückziehen“: the open recipients (or one) no longer have to sign. */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { recipientId } = await readValidatedBody(event, signRequestRecipientSchema.parse)
  return { count: withdrawSignRequest(useDb(), await withHomeGroup(event, sender), id, recipientId) }
})
