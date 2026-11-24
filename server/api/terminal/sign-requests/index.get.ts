import { todayIso } from '../../../../shared/domain/dates'
import { listMySignRequests, tabletSigner } from '../../../services/signRequests'

/** At the tablet unlocked with a PIN: that person's open requests only (403 tablet_locked otherwise). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const signer = tabletSigner(useDb(), terminal, await childUnlockToken(event))
  return listMySignRequests(useDb(), signer.employeeId, todayIso())
})
