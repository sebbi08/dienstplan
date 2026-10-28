import { getOpeningHours } from '../services/openingHours'

/** The opening hours of the facility the manager works in and the own hours of its groups. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  return getOpeningHours(useDb(), admin.facilityId)
})
