import { yearQuery } from '../../schemas'
import { listEarlySickLeaves } from '../../services/earlySickLeaves'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listEarlySickLeaves(useDb(), admin.facilityId, year)
})
