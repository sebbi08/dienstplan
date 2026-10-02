import { idParams, weekTemplateApplySchema } from '../../../schemas'
import { applyWeekTemplate } from '../../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { weekStart } = await readValidatedBody(event, weekTemplateApplySchema.parse)
  return applyWeekTemplate(useDb(), admin, id, weekStart)
})
