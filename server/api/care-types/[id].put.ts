import { careTypeSchema, idParams } from '../../schemas'
import { updateCareType } from '../../services/careTypes'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCareType(useDb(), admin.facilityId, id, await readValidatedBody(event, careTypeSchema.parse))
})
