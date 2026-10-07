import { idParams } from '../../schemas'
import { deleteAdjustment } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteAdjustment(useDb(), admin.facilityId, id)
  return { ok: true }
})
