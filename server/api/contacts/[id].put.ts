import { contactSchema, idParams } from '../../schemas'
import { updateContact } from '../../services/contacts'

export default defineServiceHandler(async (event) => {
  // The facility's contacts (another facility's is 404); one for all facilities only with contacts.global.
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, contactSchema.parse)
  updateContact(useDb(), editor, id, body)
  return { ok: true }
})
