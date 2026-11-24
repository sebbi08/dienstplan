import { todayIso } from '../../../shared/domain/dates'
import { overdueSignRequestCount } from '../../services/signRequests'

/** How many of the requests the sender may see are overdue (the count at „Dokumente“ and „Unterschriften“). */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  return { count: overdueSignRequestCount(useDb(), await withHomeGroup(event, sender), todayIso()) }
})
