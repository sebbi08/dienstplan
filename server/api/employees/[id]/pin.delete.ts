import { idParams } from '../../../schemas'
import { assertEmployee } from '../../../services/employees'
import { clearPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertEmployee(useDb(), admin.facilityId, id)
  clearPin(useDb(), id)
  return { ok: true }
})
