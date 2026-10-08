import { listGroups } from '../services/groups'

/** The groups of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listGroups(useDb(), admin.facilityId)
})
