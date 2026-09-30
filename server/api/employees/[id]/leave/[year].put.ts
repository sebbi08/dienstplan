import { employeeYearParams, entitlementSchema } from '../../../../schemas'
import { setEntitlement } from '../../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id, year } = await getValidatedRouterParams(event, employeeYearParams.parse)
  setEntitlement(useDb(), id, year, await readValidatedBody(event, entitlementSchema.parse))
  return { ok: true }
})
