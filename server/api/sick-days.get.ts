import { yearQuery } from '../schemas'
import { getSickYear } from '../services/calendar'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getSickYear(useDb(), year)
})
