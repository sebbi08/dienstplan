import { weekTemplateSaveSchema } from '../../schemas'
import { saveWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return saveWeekTemplate(useDb(), admin.facilityId, await readValidatedBody(event, weekTemplateSaveSchema.parse))
})
