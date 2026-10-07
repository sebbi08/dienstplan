import { yearQuery } from '../../schemas'
import { listEarlyClosures } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listEarlyClosures(useDb(), admin.facilityId, year)
})
