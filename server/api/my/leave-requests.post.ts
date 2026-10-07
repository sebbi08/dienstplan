import { todayIso } from '../../../shared/domain/dates'
import { leaveRequestSchema } from '../../schemas'
import { createLeaveRequest } from '../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return { id: createLeaveRequest(useDb(), user, await readValidatedBody(event, leaveRequestSchema.parse), todayIso()) }
})
