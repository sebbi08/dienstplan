import { idParams, longAbsenceSchema } from '../../schemas'
import { updateLongAbsence } from '../../services/longAbsence'

/** Changes a long absence (e.g. ends it); answers the duties still planned in the period. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, longAbsenceSchema.parse)
  return updateLongAbsence(useDb(), scope, id, input)
})
