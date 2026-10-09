import { todayIso } from '../../../shared/domain/dates'
import { listArchive } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listArchive(useDb(), admin.facilityId, todayIso())
})
