import { idParams } from '../../schemas'
import { deleteBem } from '../../services/bem'

/** Deletes a BEM started by mistake, only while nothing is answered (409 bem_state_invalid). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteBem(useDb(), scope, id)
  return { ok: true }
})
