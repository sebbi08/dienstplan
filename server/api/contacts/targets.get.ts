import { contactTargetOptions } from '../../services/contacts'

/** What „Gilt für“ offers whoever maintains the contacts: the Träger every facility with its groups, else the own facility. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'contacts.manage', { facility: 'active' })
  return contactTargetOptions(useDb(), editor)
})
