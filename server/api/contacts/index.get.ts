import { listContacts } from '../../services/contacts'

/**
 * The address book of the active facility: every account (contacts.view) and the facility's tablet; whoever holds
 * contacts.manage sees every contact, everyone else only those marked for the staff.
 */
export default defineServiceHandler(async (event) => {
  const reader = await requirePermission(event, 'contacts.view', { allowTerminal: true, facility: 'active' })
  return listContacts(useDb(), reader)
})
