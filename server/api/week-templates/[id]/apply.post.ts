import { idParams, weekTemplateApplySchema } from '../../../schemas'
import { applyWeekTemplate } from '../../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { weekStart } = await readValidatedBody(event, weekTemplateApplySchema.parse)
  return applyWeekTemplate(useDb(), admin, admin.facilityId, id, weekStart)
})
