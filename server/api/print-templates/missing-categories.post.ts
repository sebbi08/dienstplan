import { missingCategoriesSchema } from '../../schemas'
import { missingCategories } from '../../services/categoryAdopt'

/**
 * Asked before saving an item of the Träger (Vorlagen) for several or all facilities: the facilities of its „Gilt für“ that
 * lack its category (or subcategory). Across all facilities, the Träger's (printTemplates.global).
 */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'printTemplates.global', { facility: 'none' })
  const body = await readValidatedBody(event, missingCategoriesSchema.parse)
  return missingCategories(useDb(), 'template', editor, body)
})
