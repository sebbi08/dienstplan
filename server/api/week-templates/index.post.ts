import { weekTemplateSaveSchema } from '../../schemas'
import { saveWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return saveWeekTemplate(useDb(), admin.facilityId, await readValidatedBody(event, weekTemplateSaveSchema.parse))
})
