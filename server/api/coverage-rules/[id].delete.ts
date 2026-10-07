import { idParams } from '../../schemas'
import { deleteCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCoverageRule(useDb(), admin.facilityId, id)
  return { ok: true }
})
