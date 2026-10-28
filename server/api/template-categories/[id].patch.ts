import { idParams, moveSchema } from '../../schemas'
import { moveCategory } from '../../services/templateCategories'

/**
 * Moves the category one place up or down among those the editor sees. On the category's own address (not
 * …/move): one more API path pushes Nuxt's typed fetch over TypeScript's instantiation depth (TS2589).
 */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveCategory(useDb(), editor, id, direction)
  return { ok: true }
})
