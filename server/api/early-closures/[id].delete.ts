import { idParams } from '../../schemas'
import { deleteEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEarlyClosure(useDb(), id)
  return { ok: true }
})
