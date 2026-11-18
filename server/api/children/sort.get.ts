import { getChildSort } from '../../services/childSort'

/** The sort order of the child lists of the facility the manager works in (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return { sort: getChildSort(useDb(), admin.facilityId) }
})
