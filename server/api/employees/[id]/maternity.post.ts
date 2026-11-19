import { todayIso } from '../../../../shared/domain/dates'
import { idParams, maternityCaseSchema } from '../../../schemas'
import { createMaternityCase } from '../../../services/maternity'

/** Enters a Mutterschutz case for the facility's employee; answers its id. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  // Never the viewer's own case: a Leitung's is handled by the Träger.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, maternityCaseSchema.parse)
  return { id: createMaternityCase(useDb(), admin, scope, id, input, todayIso()) }
})
