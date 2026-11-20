import { idParams, leaveExtraDaysSchema } from '../../../schemas'
import { addLeaveExtraDays } from '../../../services/leaveExtraDays'

// „Zusatztag nur für dieses Jahr“: the same right and own-employee rule as saving the entitlement (leave/[year].put.ts).
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const extraId = addLeaveExtraDays(useDb(), admin, admin.facilityId, id, await readValidatedBody(event, leaveExtraDaysSchema.parse))
  return { id: extraId }
})
