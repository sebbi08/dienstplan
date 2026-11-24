import { missingCategoriesSchema } from '../../schemas'
import { missingCategories } from '../../services/categoryAdopt'

/**
 * Asked before saving an item of the Träger (Kontakte) for several or all facilities: the facilities of its „Gilt für“ that
 * lack its category (or subcategory). Across all facilities, the Träger's (contacts.global).
 */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'contacts.global', { facility: 'none' })
  const body = await readValidatedBody(event, missingCategoriesSchema.parse)
  return missingCategories(useDb(), 'contact', editor, body)
})
