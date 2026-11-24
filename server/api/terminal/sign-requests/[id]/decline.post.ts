import { idParams, signDeclineSchema } from '../../../../schemas'
import { declineMyRequest, tabletSigner } from '../../../../services/signRequests'

/** „Nicht unterschreiben“ with a reason, at the tablet unlocked by the person. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const signer = tabletSigner(useDb(), terminal, await childUnlockToken(event))
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { reason } = await readValidatedBody(event, signDeclineSchema.parse)
  declineMyRequest(useDb(), signer, id, reason)
  return { ok: true }
})
