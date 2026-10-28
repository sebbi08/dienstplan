import { idParams } from '../../../schemas'
import { clearPin } from '../../../services/terminal'
import { assertPinManageable } from '../../../services/users'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertPinManageable(useDb(), admin, id)
  clearPin(useDb(), admin.facilityId, id)
  return { ok: true }
})
