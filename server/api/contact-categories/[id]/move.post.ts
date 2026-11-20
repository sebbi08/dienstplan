import { idParams, moveSchema } from '../../../schemas'
import { moveContactCategory } from '../../../services/contacts'

/** One place up or down in the facility's list. */
export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveContactCategory(useDb(), editor, id, direction)
  return { ok: true }
})
