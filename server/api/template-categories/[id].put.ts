import { idParams, templateCategorySchema } from '../../schemas'
import { updateCategory } from '../../services/templateCategories'

export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, templateCategorySchema.parse)
  updateCategory(useDb(), editor, id, body)
  return { ok: true }
})
