import { idParams, requirementTypeSchema } from '../../schemas'
import { updateRequirementType } from '../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateRequirementType(useDb(), admin.facilityId, id, await readValidatedBody(event, requirementTypeSchema.parse))
  return { ok: true }
})
