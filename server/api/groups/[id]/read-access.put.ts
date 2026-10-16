import { groupReadAccessSchema, idParams } from '../../../schemas'
import { readAccessFacility, setReadAccess } from '../../../services/groupReadAccess'

/**
 * Sets the groups the staff of this group may also read (one direction; every group of the same facility). The Leitung
 * sets it for a group of the active facility, the Träger for any group (see `readAccessFacility`).
 */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { readable } = await readValidatedBody(event, groupReadAccessSchema.parse)
  const db = useDb()
  setReadAccess(db, readAccessFacility(db, admin, id), id, readable)
  return { ok: true }
})
