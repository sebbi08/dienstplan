import { earlyClosureSchema } from '../../schemas'
import { createEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return createEarlyClosure(useDb(), admin.facilityId, await readValidatedBody(event, earlyClosureSchema.parse))
})
