import { idParams } from '../../../../schemas'
import { withdrawLeaveRequest } from '../../../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  withdrawLeaveRequest(useDb(), user, id)
  return { ok: true }
})
