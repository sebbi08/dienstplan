import { listGroups } from '../services/groups'

/** The groups of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return listGroups(useDb(), admin.facilityId)
})
