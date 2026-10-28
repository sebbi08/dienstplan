import { adjustmentPaidOutSchema, adjustmentParams } from '../../../../schemas'
import { setAdjustmentPaidOut } from '../../../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id, adjustmentId } = await getValidatedRouterParams(event, adjustmentParams.parse)
  const { paidOut } = await readValidatedBody(event, adjustmentPaidOutSchema.parse)
  setAdjustmentPaidOut(useDb(), admin, admin.facilityId, id, adjustmentId, paidOut)
  return { ok: true }
})
