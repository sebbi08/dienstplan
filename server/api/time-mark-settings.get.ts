import { getTimeMarkSettings } from '../services/timeMarkSettings'

/** How the time tracking of the manager's facility marks late arrivals and early leaving. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getTimeMarkSettings(useDb(), admin.facilityId)
})
