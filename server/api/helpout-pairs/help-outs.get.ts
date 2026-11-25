import { todayIso } from '../../../shared/domain/dates'
import { helpoutPairQuery } from '../../schemas'
import { helpOutsBetween } from '../../services/helpoutPairs'

/** The help-outs planned between two facilities from today on, shown to the Träger before their pair is ended. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'facilities.manage', { facility: 'none' })
  const { facilityId, otherFacilityId } = await getValidatedQuery(event, helpoutPairQuery.parse)
  return helpOutsBetween(useDb(), actor, facilityId, otherFacilityId, todayIso())
})
