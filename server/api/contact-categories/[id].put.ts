import { contactCategorySchema, idParams } from '../../schemas'
import { renameContactCategory } from '../../services/contacts'

export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, contactCategorySchema.parse)
  renameContactCategory(useDb(), editor, id, body)
  return { ok: true }
})
