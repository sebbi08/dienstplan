import { idParams } from '../../../schemas'
import { clearPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  clearPin(useDb(), admin.facilityId, id)
  return { ok: true }
})
