import { idParams } from '../../../schemas'
import { getEmployeeMaternity } from '../../../services/maternity'

/**
 * The section „Mutterschutz“ of the employee page: the cases and whether the viewer may book the plan. Health data:
 * employees.sickness, the active facility's employees, never the viewer's own (403 maternity_own).
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeMaternity(useDb(), admin, scope, id)
})
