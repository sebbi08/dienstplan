import { idParams } from '../../../schemas'
import { unleaveChild } from '../../../services/children'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  unleaveChild(useDb(), admin.facilityId, id)
  return { ok: true }
})
