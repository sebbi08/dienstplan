import { weekTemplateSaveSchema } from '../../schemas'
import { saveWeekTemplate } from '../../services/weekTemplates'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return saveWeekTemplate(useDb(), await readValidatedBody(event, weekTemplateSaveSchema.parse))
})
