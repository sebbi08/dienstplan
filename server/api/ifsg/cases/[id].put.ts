import { idParams, ifsgCaseUpdateSchema } from '../../../schemas'
import { updateIfsgCase } from '../../../services/ifsg'

/** Changes a case: dates and rule by the child's group and the managers, the health office fields by the managers only. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateIfsgCase(useDb(), viewer, id, await readValidatedBody(event, ifsgCaseUpdateSchema.parse))
  return { ok: true }
})
