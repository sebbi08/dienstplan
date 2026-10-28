import { idParams } from '../../../schemas'
import { markDocDone } from '../../../services/reminders'

/** Marks the child's development documentation done today; the service checks the group right. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { id: markDocDone(useDb(), viewer, id) }
})
