import { notificationsReadSchema } from '../../../schemas'
import { markNotificationsRead } from '../../../services/notifications'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { ids } = await readValidatedBody(event, notificationsReadSchema.parse)
  if (user.employeeId !== null) markNotificationsRead(useDb(), user.employeeId, ids)
  return { ok: true }
})
