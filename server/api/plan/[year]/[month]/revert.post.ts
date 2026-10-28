import { monthParams, revertSchema } from '../../../../schemas'
import { revertToRelease } from '../../../../services/revert'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.release')
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  const { keys } = await readValidatedBody(event, revertSchema.parse)
  return { reverted: revertToRelease(useDb(), admin, admin.facilityId, year, month, keys) }
})
