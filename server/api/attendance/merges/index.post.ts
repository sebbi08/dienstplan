import { groupMergeSchema } from '../../../schemas'
import { createGroupMerge } from '../../../services/groupMerges'

/** „Gruppen zusammenlegen“ for today: whoever stamps in the day list may, for any groups of the facility. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const body = await readValidatedBody(event, groupMergeSchema.parse)
  return { id: createGroupMerge(useDb(), viewer, body) }
})
