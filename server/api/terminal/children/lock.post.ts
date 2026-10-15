import type { TabletUnlockStatusDto } from '../../../../shared/types/api'
import { lockChildren } from '../../../services/tabletUnlock'

/** Ends this tablet's unlock (only its own, see lockChildren). */
export default defineServiceHandler(async (event): Promise<TabletUnlockStatusDto> => {
  const terminal = await requireTerminal(event)
  lockChildren(useDb(), terminal.id, await childUnlockToken(event))
  return { unlocked: false }
})
