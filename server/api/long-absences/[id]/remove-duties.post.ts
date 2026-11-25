import { idParams } from '../../../schemas'
import { removeLongAbsenceDuties } from '../../../services/longAbsence'

/**
 * „Dienste entfernen“: the duties still planned in the long absence leave the plan (each logged as a plan change); the
 * plan needs plan.edit (403 forbidden, checked in the service). Answers the days.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return removeLongAbsenceDuties(useDb(), admin, scope, id)
})
