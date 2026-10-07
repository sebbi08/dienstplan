import { leaveMaxSchema } from '../../schemas'
import { setMaxConcurrent } from '../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  // Managers only; the service also checks that the account is responsible for leave planning.
  const user = await requireAdmin(event)
  const { value } = await readValidatedBody(event, leaveMaxSchema.parse)
  setMaxConcurrent(useDb(), user, user.facilityId, value)
  return { ok: true }
})
