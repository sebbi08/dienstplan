import type { TabletUnlockStatusDto } from '../../../../shared/types/api'
import { lockChildren } from '../../../services/tabletUnlock'

export default defineServiceHandler(async (event): Promise<TabletUnlockStatusDto> => {
  const terminal = await requireTerminal(event)
  lockChildren(useDb(), terminal.id)
  return { unlocked: false }
})
