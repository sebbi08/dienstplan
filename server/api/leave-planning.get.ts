import { yearQuery } from '../schemas'
import { getLeavePlanning } from '../services/leaveRequests'

export default defineServiceHandler(async (event) => {
  // Managers only; the service also checks that the account is responsible for leave planning.
  const user = await requirePermission(event, 'leave.overview')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getLeavePlanning(useDb(), user, user.facilityId, year)
})
