import { idParams } from '../../schemas'
import { deleteCategory } from '../../services/templateCategories'

/**
 * Only an empty category (409 template_category_not_empty while templates of the facility are filed in it; templates
 * for all facilities filed by its name move to „Vom Träger“).
 */
export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCategory(useDb(), editor, id)
  return { ok: true }
})
