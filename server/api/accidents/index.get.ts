import { yearQuery } from '../../schemas'
import { listAccidentOverview } from '../../services/accidents'

/**
 * „Unfälle“: the active facility's accident reports dated in the year (Leitung/Träger). Children's reports follow the
 * account's view of the child records (group scope, archive); without children.ownAccount only the employees' are listed.
 */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'accidents.manage')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listAccidentOverview(useDb(), actor, actor.facilityId, accidentChildViewer(actor), year)
})
