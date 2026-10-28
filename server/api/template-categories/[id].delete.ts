import { idParams } from '../../schemas'
import { deleteCategory } from '../../services/templateCategories'

/** Only an empty category (409 template_category_not_empty while templates of any facility are filed in it). */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCategory(useDb(), editor, id)
  return { ok: true }
})
