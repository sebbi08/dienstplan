import { idParams } from '../../schemas'
import { deleteRequirementType } from '../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteRequirementType(useDb(), admin.facilityId, id)
  return { ok: true }
})
