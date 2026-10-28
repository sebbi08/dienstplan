import { closureSchema } from '../../schemas'
import { createClosure } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  return createClosure(useDb(), admin, admin.facilityId, await readValidatedBody(event, closureSchema.parse))
})
