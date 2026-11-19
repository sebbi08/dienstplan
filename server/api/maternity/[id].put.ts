import { todayIso } from '../../../shared/domain/dates'
import { idParams, maternityCaseSchema } from '../../schemas'
import { updateMaternityCase } from '../../services/maternity'

/** Saves a Mutterschutz case; a booked period that changed is booked again in the plan (with plan.edit). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, maternityCaseSchema.parse)
  return updateMaternityCase(useDb(), admin, scope, id, input, todayIso())
})
