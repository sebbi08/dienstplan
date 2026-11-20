import { idParams } from '../../schemas'
import { deleteContactCategory } from '../../services/contacts'

/** Only an empty category (409 contact_category_not_empty while contacts of the facility are filed in it). */
export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in (another facility's is 404).
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteContactCategory(useDb(), editor, id)
  return { ok: true }
})
