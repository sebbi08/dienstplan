import { idParams, moveSchema } from '../../../schemas'
import { moveCategory } from '../../../services/templateCategories'

/** One place up or down among the categories the editor sees. */
export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'printTemplates.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveCategory(useDb(), editor, id, direction)
  return { ok: true }
})
