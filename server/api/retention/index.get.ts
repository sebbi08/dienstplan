import { todayIso } from '../../../shared/domain/dates'
import type { RetentionItemDto } from '../../../shared/types/api'
import { retentionOverview } from '../../services/retentionOverview'

/** What may be deleted after a retention period, in every facility; only the Träger (spec Löschübersicht §2). */
export default defineServiceHandler(async (event): Promise<RetentionItemDto[]> => {
  await requirePermission(event, 'retention.delete', { facility: 'none' })
  return retentionOverview(useDb(), todayIso())
})
