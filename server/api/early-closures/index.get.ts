import { yearQuery } from '../../schemas'
import { listEarlyClosures } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listEarlyClosures(useDb(), year)
})
