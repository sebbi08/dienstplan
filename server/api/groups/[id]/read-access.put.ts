import { groupReadAccessSchema, idParams } from '../../../schemas'
import { setReadAccess } from '../../../services/groupReadAccess'
import { facilityOfGroup } from '../../../services/groups'

/**
 * Sets the groups the staff of this group may also read (one direction; every group of the same facility). The Leitung
 * sets it for a group of the active facility; the Träger, whose facility settings list every facility, for any group.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { readable } = await readValidatedBody(event, groupReadAccessSchema.parse)
  const db = useDb()
  setReadAccess(db, admin.role === 'provider' ? facilityOfGroup(db, id) : admin.facilityId, id, readable)
  return { ok: true }
})
