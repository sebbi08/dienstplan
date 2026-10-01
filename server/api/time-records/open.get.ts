import { todayIso } from '../../../shared/domain/dates'
import { listOpenRecords } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listOpenRecords(useDb(), todayIso())
})
