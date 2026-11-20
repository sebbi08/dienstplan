import { idParams } from '../../schemas'
import { deleteContact } from '../../services/contacts'

export default defineServiceHandler(async (event) => {
  // The facility's contacts (another facility's is 404); one for all facilities only with contacts.global.
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteContact(useDb(), editor, id)
  return { ok: true }
})
