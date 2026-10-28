import { listFacilities } from '../services/facilities'

export default defineServiceHandler(async (event) => {
  // The header's switcher and every page name the active facility, also while the Träger edits another one's settings.
  const user = await requirePermission(event, 'settings.facility', { facility: 'active' })
  return listFacilities(useDb(), user)
})
