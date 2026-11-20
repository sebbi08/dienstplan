import { contactSchema } from '../../schemas'
import { createContact } from '../../services/contacts'

export default defineServiceHandler(async (event) => {
  // A contact of the facility the editor works in; for all facilities only with contacts.global (the service checks).
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const body = await readValidatedBody(event, contactSchema.parse)
  return { id: createContact(useDb(), editor, body) }
})
