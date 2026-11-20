import { templateCategorySchema } from '../../schemas'
import { createCategory } from '../../services/templateCategories'

export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'printTemplates.edit')
  const body = await readValidatedBody(event, templateCategorySchema.parse)
  return { id: createCategory(useDb(), editor, body) }
})
