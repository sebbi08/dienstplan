import { templateCategorySchema } from '../../schemas'
import { createCategory } from '../../services/templateCategories'

export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'printTemplates.edit')
  const body = await readValidatedBody(event, templateCategorySchema.parse)
  return { id: createCategory(useDb(), editor, body) }
})
