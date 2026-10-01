import { todayIso } from '../../../shared/domain/dates'
import { timeMonthQuery } from '../../schemas'
import { getTimeMonth } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { employeeId, year, month } = await getValidatedQuery(event, timeMonthQuery.parse)
  return getTimeMonth(useDb(), employeeId, year, month, todayIso())
})
