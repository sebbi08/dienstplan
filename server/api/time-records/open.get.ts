import { todayIso } from '../../../shared/domain/dates'
import { listOpenRecords } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listOpenRecords(useDb(), admin.facilityId, todayIso())
})
