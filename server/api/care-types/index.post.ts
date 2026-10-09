import { careTypeSchema } from '../../schemas'
import { createCareType } from '../../services/careTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return createCareType(useDb(), admin.facilityId, await readValidatedBody(event, careTypeSchema.parse))
})
