import { templateCategorySchema } from '../../schemas'
import { createCategory } from '../../services/templateCategories'

// The shared categories of „Vorlagen“ for whoever maintains the Bögen (formTemplates.manage); whoever maintains the PDF
// templates uses /api/template-categories. Same rules either way (server/services/templateCategories.ts).
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'formTemplates.manage')
  const body = await readValidatedBody(event, templateCategorySchema.parse)
  return { id: createCategory(useDb(), admin, body) }
})
