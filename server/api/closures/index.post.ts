import { closureSchema } from '../../schemas'
import { createClosure } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return createClosure(useDb(), admin, admin.facilityId, await readValidatedBody(event, closureSchema.parse))
})
