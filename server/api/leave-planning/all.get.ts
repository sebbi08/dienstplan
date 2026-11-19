import { todayIso } from '../../../shared/domain/dates'
import type { LeaveYearListDto } from '../../../shared/types/api'
import { leaveYearListQuery } from '../../schemas'
import { getLeaveYearList } from '../../services/leaveYearList'

/** „Urlaubsplanung“ → „Alle Anträge und Urlaube“ (and its print view): as the planning page, the service checks the planner. */
export default defineServiceHandler(async (event): Promise<LeaveYearListDto> => {
  const user = await requirePermission(event, 'leave.overview')
  const { year, ...filter } = await getValidatedQuery(event, leaveYearListQuery.parse)
  return getLeaveYearList(useDb(), user, user.facilityId, year, filter, todayIso())
})
