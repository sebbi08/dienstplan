import { idParams, signDeclineSchema } from '../../../../schemas'
import { declineMyRequest } from '../../../../services/signRequests'
import { tabletSigner } from '../../../../services/signUnlock'

/** „Nicht unterschreiben“ with a reason, at the tablet unlocked for signing by the person. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const signer = tabletSigner(useDb(), terminal, await signUnlockToken(event))
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { reason } = await readValidatedBody(event, signDeclineSchema.parse)
  declineMyRequest(useDb(), signer, id, reason)
  return { ok: true }
})
