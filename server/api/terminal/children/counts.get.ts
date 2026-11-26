import type { ChildCountsDto } from '../../../../shared/types/api'
import { childCountsToday } from '../../../services/countsOnly'
import { tabletCountsFacility } from '../../../services/tabletUnlock'

/**
 * „Kinder heute“: today's names-free numbers, only for a person with „Nur Kinderzahlen“ who unlocked the tablet (the
 * service checks the unlock; reading is no use of the tablet).
 */
export default defineServiceHandler(async (event): Promise<ChildCountsDto> => {
  const terminal = await requireTerminal(event)
  const db = useDb()
  return childCountsToday(db, tabletCountsFacility(db, terminal, await childUnlockToken(event)))
})
