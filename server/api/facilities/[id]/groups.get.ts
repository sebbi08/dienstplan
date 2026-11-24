import { idParams } from '../../../schemas'
import { assertFacilityInReach } from '../../../services/facilities'
import { listGroups } from '../../../services/groups'

/**
 * The groups of a facility, for the facility cards of the settings: the Träger any facility's (settings.otherFacility),
 * everyone else only their own facility's (403 otherwise).
 */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'settings.groups', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  assertFacilityInReach(db, user, id)
  return listGroups(db, id)
})
