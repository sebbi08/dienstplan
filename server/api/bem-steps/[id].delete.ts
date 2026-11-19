import { idParams } from '../../schemas'
import { deleteBemStep } from '../../services/bem'

/** Removes a step of a running BEM. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteBemStep(useDb(), scope, id)
  return { ok: true }
})
