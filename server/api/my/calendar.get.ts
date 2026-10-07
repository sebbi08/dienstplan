import { yearQuery } from '../../schemas'
import { getMyYearCalendar } from '../../services/calendar'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  // The calendar of the facility of the viewer's employee (403 no_employee without one).
  return getMyYearCalendar(useDb(), user, year)
})
