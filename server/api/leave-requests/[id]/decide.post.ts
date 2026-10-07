import { idParams, leaveDecisionSchema } from '../../../schemas'
import { decideLeaveRequest } from '../../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  // Managers only; the service also checks that the account is responsible for leave planning.
  const user = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  decideLeaveRequest(useDb(), user, id, await readValidatedBody(event, leaveDecisionSchema.parse))
  return { ok: true }
})
