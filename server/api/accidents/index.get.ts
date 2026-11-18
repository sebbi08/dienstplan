import { yearQuery } from '../../schemas'
import { listAccidentOverview } from '../../services/accidents'

/** „Unfälle“: every accident report of the active facility dated in the year (Leitung/Träger). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'accidents.manage')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listAccidentOverview(useDb(), actor, actor.facilityId, year)
})
