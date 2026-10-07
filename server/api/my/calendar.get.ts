import { yearQuery } from '../../schemas'
import { getStaffYearCalendar } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getStaffYearCalendar(useDb(), year, user.employeeId)
})
