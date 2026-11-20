import { staffContactCount } from '../../services/contacts'

/** How many contacts the staff of the facility see: the menu shows „Kontakte“ to Mitarbeiter only when there are any. */
export default defineServiceHandler(async (event) => {
  const reader = await requirePermission(event, 'contacts.view', { facility: 'active' })
  return { count: staffContactCount(useDb(), reader.facilityId) }
})
