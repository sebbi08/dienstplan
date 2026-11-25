import { idParams } from '../../schemas'
import { deleteLongAbsence } from '../../services/longAbsence'

/** Deletes a long absence entered by mistake; no plan entry is touched. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteLongAbsence(useDb(), scope, id)
  return { ok: true }
})
