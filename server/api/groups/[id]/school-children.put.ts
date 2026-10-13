import { groupSchoolChildrenSchema, idParams } from '../../../schemas'
import { setGroupForSchoolChildren } from '../../../services/groups'

/**
 * The Träger flags a group of any facility (not only the active one) as being for school children, or takes the flag
 * away. `autoLeaveSwitchedOff`: taking the flag away switched the automatic leaving of the group's facility off.
 */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { forSchoolChildren } = await readValidatedBody(event, groupSchoolChildrenSchema.parse)
  // Finds the group whatever its facility is; an unknown id answers 404 group_not_found.
  const { autoLeaveSwitchedOff } = setGroupForSchoolChildren(useDb(), id, forSchoolChildren)
  return { ok: true, autoLeaveSwitchedOff }
})
