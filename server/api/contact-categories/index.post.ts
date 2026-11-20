import { contactCategorySchema } from '../../schemas'
import { createContactCategory } from '../../services/contacts'

export default defineServiceHandler(async (event) => {
  // The categories of the facility the editor works in.
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  const body = await readValidatedBody(event, contactCategorySchema.parse)
  return { id: createContactCategory(useDb(), editor, body) }
})
