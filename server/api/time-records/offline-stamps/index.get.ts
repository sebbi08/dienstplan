import { listOfflineStampHints } from '../../../services/offlineStamps'

/** The review list of offline stamps not taken over (time page). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  return listOfflineStampHints(useDb(), admin.facilityId)
})
