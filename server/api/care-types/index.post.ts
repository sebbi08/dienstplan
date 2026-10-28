import { careTypeSchema } from '../../schemas'
import { createCareType } from '../../services/careTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return createCareType(useDb(), admin.facilityId, await readValidatedBody(event, careTypeSchema.parse))
})
