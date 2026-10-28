import { idParams } from '../../schemas'
import { deleteEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEarlyClosure(useDb(), admin.facilityId, id)
  return { ok: true }
})
