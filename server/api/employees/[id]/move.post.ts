import { idParams, moveSchema } from '../../../schemas'
import { moveEmployee } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveEmployee(useDb(), admin.facilityId, id, direction)
  return { ok: true }
})
