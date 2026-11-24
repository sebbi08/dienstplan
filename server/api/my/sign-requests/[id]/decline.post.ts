import { idParams, signDeclineSchema } from '../../../../schemas'
import { accountSigner, declineMyRequest } from '../../../../services/signRequests'

/** „Nicht unterschreiben“ with a reason, with the own account. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const signer = accountSigner(user)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { reason } = await readValidatedBody(event, signDeclineSchema.parse)
  declineMyRequest(useDb(), signer, id, reason)
  return { ok: true }
})
