import { requirementTypeSchema } from '../schemas'
import { createRequirementType } from '../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return createRequirementType(useDb(), admin.facilityId, await readValidatedBody(event, requirementTypeSchema.parse))
})
