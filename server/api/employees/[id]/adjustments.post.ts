import { adjustmentSchema, idParams } from '../../../schemas'
import { addAdjustment } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  addAdjustment(useDb(), admin.facilityId, id, await readValidatedBody(event, adjustmentSchema.parse))
  return { ok: true }
})
