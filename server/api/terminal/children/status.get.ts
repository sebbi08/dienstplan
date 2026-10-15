import { tabletUnlockStatus } from '../../../services/tabletUnlock'

/** Whether the tablet is unlocked and for whom; changes nothing. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  return tabletUnlockStatus(useDb(), terminal, await childUnlockToken(event))
})
