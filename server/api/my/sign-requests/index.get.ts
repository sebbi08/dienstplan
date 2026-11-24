import { todayIso } from '../../../../shared/domain/dates'
import { accountSigner, listMySignRequests } from '../../../services/signRequests'

/** Meins → Zu unterschreiben: the own employee's open requests (403 no_employee without a linked employee). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return listMySignRequests(useDb(), accountSigner(user).employeeId, todayIso())
})
