import { idParams } from '../../schemas'
import { deleteTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTemplate(useDb(), id)
  return { ok: true }
})
