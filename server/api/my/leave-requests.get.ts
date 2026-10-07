import { listMyLeaveRequests } from '../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return listMyLeaveRequests(useDb(), user)
})
