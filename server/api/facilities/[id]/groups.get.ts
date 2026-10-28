import { idParams } from '../../../schemas'
import { assertFacility } from '../../../services/facilities'
import { listGroups } from '../../../services/groups'

/** The groups of any facility, for the Träger's facility settings. */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'settings.groups', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  assertFacility(db, id)
  return listGroups(db, id)
})
