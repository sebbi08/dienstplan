import { can } from '../../../../shared/domain/permissions'
import { groupSchoolChildrenSchema, idParams } from '../../../schemas'
import { facilityOfGroup, setGroupForSchoolChildren } from '../../../services/groups'
import { ServiceError } from '../../../lib/errors'

/**
 * The Träger flags a group of any facility (not only the active one) as being for school children, or takes the flag
 * away. `autoLeaveSwitchedOff`: taking the flag away switched the automatic leaving of the group's facility off.
 */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'children.schoolSettings', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { forSchoolChildren } = await readValidatedBody(event, groupSchoolChildrenSchema.parse)
  const db = useDb()
  // Finds the group whatever its facility is; an unknown id answers 404 group_not_found. Without the right to edit other
  // facilities, a group of another facility than the one the user works in is unknown too.
  if (!can(user.permissions, 'settings.otherFacility') && facilityOfGroup(db, id) !== user.facilityId) {
    throw new ServiceError(404, 'group_not_found')
  }
  const { autoLeaveSwitchedOff } = setGroupForSchoolChildren(db, id, forSchoolChildren)
  return { ok: true, autoLeaveSwitchedOff }
})
