import { idParams, leaveDecisionSchema } from '../../../schemas'
import { decideLeaveRequest } from '../../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  // Managers only; the service also checks that the account is responsible for leave planning.
  const user = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return decideLeaveRequest(useDb(), user, user.facilityId, id, await readValidatedBody(event, leaveDecisionSchema.parse))
})
