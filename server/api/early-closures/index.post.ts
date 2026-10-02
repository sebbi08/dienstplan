import { earlyClosureSchema } from '../../schemas'
import { createEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createEarlyClosure(useDb(), await readValidatedBody(event, earlyClosureSchema.parse))
})
