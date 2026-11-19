import { employeeYearParams } from '../../../../schemas'
import { deleteEntitlement } from '../../../../services/employees'

// Same right and own-employee rule as saving the entitlement (PUT).
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id, year } = await getValidatedRouterParams(event, employeeYearParams.parse)
  deleteEntitlement(useDb(), admin.facilityId, id, year, admin)
  return { ok: true }
})
