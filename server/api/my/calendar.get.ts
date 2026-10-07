import { yearQuery } from '../../schemas'
import { getStaffYearCalendar } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  // The calendar of the facility of the viewer's employee (a manager's own facility).
  return getStaffYearCalendar(useDb(), requireFacility(user), year, user.employeeId)
})
