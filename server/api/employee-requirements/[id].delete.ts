import { idParams } from '../../schemas'
import { deleteRequirementRecord } from '../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteRequirementRecord(useDb(), admin.facilityId, id)
  return { ok: true }
})
