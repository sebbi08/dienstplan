import { todayIso } from '../../../../shared/domain/dates'
import { listMySignRequests } from '../../../services/signRequests'
import { tabletSigner } from '../../../services/signUnlock'

/** At the tablet unlocked for signing: that person's open requests of this facility only (403 sign_locked otherwise). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const signer = tabletSigner(useDb(), terminal, await signUnlockToken(event))
  return listMySignRequests(useDb(), signer, todayIso())
})
