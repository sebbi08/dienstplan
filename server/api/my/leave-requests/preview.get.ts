import { todayIso } from '../../../../shared/domain/dates'
import { leaveRangeQuery } from '../../../schemas'
import { previewLeaveRequest } from '../../../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { from, to } = await getValidatedQuery(event, leaveRangeQuery.parse)
  return previewLeaveRequest(useDb(), user, from, to, todayIso())
})
