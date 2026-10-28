import { yearQuery } from '../schemas'
import { getSickYear } from '../services/calendar'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getSickYear(useDb(), admin.facilityId, year)
})
