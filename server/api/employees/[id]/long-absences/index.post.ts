import { idParams, longAbsenceSchema } from '../../../../schemas'
import { createLongAbsence } from '../../../../services/longAbsence'

/** „Längere Abwesenheit eintragen“ for the facility's employee; answers its id and the duties still planned in the period. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  // Never the viewer's own: a Leitung's is entered by the Träger.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, longAbsenceSchema.parse)
  return createLongAbsence(useDb(), admin, scope, id, input)
})
