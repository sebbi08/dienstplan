import { globalCategoryNames } from '../../services/templateCategories'

/** The category names the facilities use, to offer the Träger for a template for all facilities. */
export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'printTemplates.global', { facility: 'none' })
  return globalCategoryNames(useDb(), provider)
})
