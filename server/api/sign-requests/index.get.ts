import { todayIso } from '../../../shared/domain/dates'
import { listSignRequests } from '../../services/signRequests'

/** Dokumente → Unterschriften: the facility's requests to sign with every recipient's status. */
export default defineServiceHandler(async (event) => {
  const sender = await requirePermission(event, 'signRequests.manage', { facility: 'active' })
  return listSignRequests(useDb(), await withHomeGroup(event, sender), todayIso())
})
