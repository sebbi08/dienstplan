import { todayIso } from '../../shared/domain/dates'
import { yearQuery } from '../schemas'
import { getLeaveOverview } from '../services/leave'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getLeaveOverview(useDb(), year, todayIso())
})
