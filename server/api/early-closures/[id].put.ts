import { earlyClosureSchema, idParams } from '../../schemas'
import { updateEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEarlyClosure(useDb(), id, await readValidatedBody(event, earlyClosureSchema.parse))
  return { ok: true }
})
