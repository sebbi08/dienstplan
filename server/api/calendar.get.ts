import { yearQuery } from '../schemas'
import { getYearCalendar } from '../services/calendar'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getYearCalendar(useDb(), year)
})
