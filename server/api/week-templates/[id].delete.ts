import { idParams } from '../../schemas'
import { deleteWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteWeekTemplate(useDb(), id)
  return { ok: true }
})
