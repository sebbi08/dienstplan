import { yearQuery } from '../schemas'
import { getYearCalendar } from '../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'calendar.edit')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getYearCalendar(useDb(), admin.facilityId, year)
})
