import { idParams, maternityBookingSchema } from '../../../schemas'
import { bookMaternity } from '../../../services/maternity'

/**
 * „Schutzfristen eintragen“ / „Beschäftigungsverbot eintragen“: writes the code on the employee's working days of the
 * period (409 cells_occupied for planned duties unless `overwrite`); the plan needs plan.edit (403 forbidden).
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { kind, overwrite } = await readValidatedBody(event, maternityBookingSchema.parse)
  return bookMaternity(useDb(), admin, scope, id, kind, overwrite)
})
