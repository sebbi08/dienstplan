import { idParams } from '../../../schemas'
import { endGroupMerge } from '../../../services/groupMerges'

/** „Zusammenlegung beenden“: ends a merge of today. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  endGroupMerge(useDb(), viewer, id)
  return { ok: true }
})
