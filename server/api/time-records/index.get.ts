import { todayIso } from '../../../shared/domain/dates'
import { seesProtectedCodes } from '../../lib/protectedCodes'
import { timeMonthQuery } from '../../schemas'
import { getTimeMonth } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { employeeId, year, month } = await getValidatedQuery(event, timeMonthQuery.parse)
  // Mutterschutz and Beschäftigungsverbot only for whoever may see the case (else „abwesend“).
  return getTimeMonth(useDb(), admin.facilityId, employeeId, year, month, todayIso(), undefined, seesProtectedCodes(admin))
})
