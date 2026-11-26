import type { TabletUnlockStatusDto } from '../../../shared/types/api'
import { startPlanEdit } from '../../services/tabletUnlock'

/**
 * „Dienstplan bearbeiten“: the person who unlocked the tablet starts editing the plan with their own account's rights
 * (403 tablet_locked without a valid unlock, 403 forbidden without an own account with plan.edit in this facility).
 */
export default defineServiceHandler(async (event): Promise<TabletUnlockStatusDto> => {
  const terminal = await requireTerminal(event)
  return startPlanEdit(useDb(), terminal, await childUnlockToken(event))
})
