import { listReadAccess } from '../services/groupReadAccess'

/** Leitung and Träger: every group of the active facility with the groups its staff may also read (by group id). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return listReadAccess(useDb(), admin.facilityId)
})
