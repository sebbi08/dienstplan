import { earlyClosureSchema } from '../../schemas'
import { createEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  return createEarlyClosure(useDb(), admin.facilityId, await readValidatedBody(event, earlyClosureSchema.parse))
})
