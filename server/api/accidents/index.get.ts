import { yearQuery } from '../../schemas'
import { listAccidentOverview } from '../../services/accidents'

/**
 * „Unfälle“: the active facility's accident reports dated in the year (Leitung/Träger). The child guard, so children's
 * reports follow the viewer's view of the child records (group scope, archive); the service refuses the tablet.
 */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'accidents.manage')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listAccidentOverview(useDb(), viewer, year)
})
