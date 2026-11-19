import { idParams } from '../../schemas'
import { deleteMaternityCase } from '../../services/maternity'

/** Deletes a Mutterschutz case entered by mistake (the plan's entries stay). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteMaternityCase(useDb(), scope, id)
  return { ok: true }
})
