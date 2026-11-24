import { idParams, signDeclineSchema } from '../../../../schemas'
import { declineMyRequest } from '../../../../services/signRequests'
import { lockSigning, tabletSigner } from '../../../../services/signUnlock'

/** „Nicht unterschreiben“ with a reason, at the tablet unlocked for signing by the person. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const token = await signUnlockToken(event)
  const signer = tabletSigner(useDb(), terminal, token)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { reason } = await readValidatedBody(event, signDeclineSchema.parse)
  declineMyRequest(useDb(), signer, id, reason)
  // Done: the tablet locks here too (not only when the page goes back to its start).
  lockSigning(useDb(), terminal.id, token)
  return { ok: true }
})
