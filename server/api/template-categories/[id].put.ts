import { idParams, templateCategorySchema } from '../../schemas'
import { updateCategory } from '../../services/templateCategories'

export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, templateCategorySchema.parse)
  updateCategory(useDb(), editor, id, body)
  return { ok: true }
})
