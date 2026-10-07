import { idParams } from '../../schemas'
import { deleteRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteRecord(useDb(), admin, admin.facilityId, id)
  return { ok: true }
})
