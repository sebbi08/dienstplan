import { bemStepSchema, idParams } from '../../schemas'
import { updateBemStep } from '../../services/bem'

/** Changes a step of a running BEM (its kind stays). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateBemStep(useDb(), scope, id, await readValidatedBody(event, bemStepSchema.parse))
  return { ok: true }
})
