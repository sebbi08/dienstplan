import { idParams } from '../../../schemas'
import { getReadAccess, readAccessFacility } from '../../../services/groupReadAccess'

/** The groups the staff of this group may also read (ids); facility as in `readAccessFacility`. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  return { readable: getReadAccess(db, readAccessFacility(db, admin, id), id) }
})
