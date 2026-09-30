import { idParams, moveSchema } from '../../../schemas'
import { moveEmployee } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveEmployee(useDb(), id, direction)
  return { ok: true }
})
