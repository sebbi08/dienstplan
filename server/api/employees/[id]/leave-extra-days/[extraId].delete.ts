import { leaveExtraDaysParams } from '../../../../schemas'
import { deleteLeaveExtraDays } from '../../../../services/leaveExtraDays'

// Same right and own-employee rule as adding (and as the entitlement).
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id, extraId } = await getValidatedRouterParams(event, leaveExtraDaysParams.parse)
  deleteLeaveExtraDays(useDb(), admin, admin.facilityId, id, extraId)
  return { ok: true }
})
