import { idParams } from '../../../schemas'
import { getReadAccess } from '../../../services/groupReadAccess'
import { facilityOfGroup } from '../../../services/groups'

/**
 * The groups the staff of this group may also read (ids). The Leitung asks for a group of the active facility; the
 * Träger, whose facility settings list every facility, for a group of any facility.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  return { readable: getReadAccess(db, admin.role === 'provider' ? facilityOfGroup(db, id) : admin.facilityId, id) }
})
