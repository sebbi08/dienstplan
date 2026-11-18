import { closureSchema, idParams } from '../../schemas'
import { updateClosure } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateClosure(useDb(), admin, admin.facilityId, id, await readValidatedBody(event, closureSchema.parse))
})
