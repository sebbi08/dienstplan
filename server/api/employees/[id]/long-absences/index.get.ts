import { idParams } from '../../../../schemas'
import { getEmployeeLongAbsences } from '../../../../services/longAbsence'

/**
 * The section „Längere Abwesenheit“ of the employee page: the entered periods, the Mutterschutz booked in the plan and
 * (with the contract data) the full Elternzeit. Health data: employees.sickness, the active facility's employees, never
 * the viewer's own (403 long_absence_own).
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeLongAbsences(useDb(), admin, scope, id)
})
