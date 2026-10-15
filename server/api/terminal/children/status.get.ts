import { tabletUnlockStatus } from '../../../services/tabletUnlock'

/** Whether the tablet is unlocked and for whom; changes nothing. */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const { childUnlock } = await getUserSession(event)
  return tabletUnlockStatus(useDb(), terminal, childUnlock)
})
