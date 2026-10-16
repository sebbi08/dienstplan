import { idParams } from '../../../schemas'
import { assertFacility } from '../../../services/facilities'
import { listReadAccess } from '../../../services/groupReadAccess'

/** The read access of the groups of any facility (by group id), for the Träger's facility settings. */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  assertFacility(db, id)
  return listReadAccess(db, id)
})
