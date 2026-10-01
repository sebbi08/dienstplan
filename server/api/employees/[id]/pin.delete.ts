import { idParams } from '../../../schemas'
import { clearPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  clearPin(useDb(), id)
  return { ok: true }
})
