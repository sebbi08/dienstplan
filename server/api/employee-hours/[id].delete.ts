import { idParams } from '../../schemas'
import { deleteHours } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteHours(useDb(), admin.facilityId, id)
  return { ok: true }
})
