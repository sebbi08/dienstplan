import { todayIso } from '../../../shared/domain/dates'
import { timeMonthQuery } from '../../schemas'
import { getTimeMonth } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { employeeId, year, month } = await getValidatedQuery(event, timeMonthQuery.parse)
  return getTimeMonth(useDb(), admin.facilityId, employeeId, year, month, todayIso())
})
