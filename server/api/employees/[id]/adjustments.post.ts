import { adjustmentSchema, idParams } from '../../../schemas'
import { addAdjustment } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  addAdjustment(useDb(), id, await readValidatedBody(event, adjustmentSchema.parse))
  return { ok: true }
})
