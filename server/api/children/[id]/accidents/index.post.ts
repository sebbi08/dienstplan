import { accidentCreateSchema, idParams } from '../../../../schemas'
import { createChildAccident } from '../../../../services/accidents'

/** „Unfallbericht ausfüllen“: whoever keeps the child's attendance (the group scope is checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, accidentCreateSchema.parse)
  return { id: createChildAccident(useDb(), viewer, id, body) }
})
