import { getLeaveSettings } from '../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return getLeaveSettings(useDb(), user)
})
