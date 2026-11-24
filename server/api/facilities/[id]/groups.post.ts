import { groupNameSchema, idParams } from '../../../schemas'
import { assertFacilityInReach } from '../../../services/facilities'
import { createGroup } from '../../../services/groups'

/** A new group of a facility: the Träger in any facility (settings.otherFacility), everyone else only in their own (403). */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'settings.groups', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { name } = await readValidatedBody(event, groupNameSchema.parse)
  const db = useDb()
  assertFacilityInReach(db, user, id)
  return createGroup(db, id, name)
})
