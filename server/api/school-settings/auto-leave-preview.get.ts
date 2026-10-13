import { todayIso } from '../../../shared/domain/dates'
import { schoolLeavers } from '../../services/schoolChildren'

/**
 * The children of the active facility the automatic leaving would deregister at once, with their leaving day: the
 * selection the daily run itself uses, shown to the Träger before the switch is turned on.
 */
export default defineServiceHandler(async (event) => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  return schoolLeavers(useDb(), facilityId, todayIso())
})
