import { listContacts } from '../../services/contacts'

/**
 * The address book of the active facility: every account (contacts.view) and the facility's tablet; whoever holds
 * contacts.manage sees every contact for the facility, everyone else only those marked for the staff whose „Gilt für“
 * allows their home group (at the tablet the unlocking person's; locked: only those for all groups).
 */
export default defineServiceHandler(async (event) => {
  const reader = await requirePermission(event, 'contacts.view', { allowTerminal: true, facility: 'active' })
  return listContacts(useDb(), await withHomeGroup(event, reader))
})
