import { idParams } from '../../../schemas'
import { deleteEntry } from '../../../services/cashEntries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEntry(useDb(), admin, admin.facilityId, id)
  return { ok: true }
})
