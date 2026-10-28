import { idParams } from '../../../schemas'
import { clearPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  clearPin(useDb(), admin.facilityId, id)
  return { ok: true }
})
