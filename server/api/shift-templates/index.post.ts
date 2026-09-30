import { templateSchema } from '../../schemas'
import { createTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createTemplate(useDb(), await readValidatedBody(event, templateSchema.parse))
})
