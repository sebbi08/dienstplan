import { todayIso } from '../../shared/domain/dates'
import { listLevelUps } from '../services/employees'

export default defineServiceHandler(async (event) => {
  const viewer = await requireAdmin(event)
  return listLevelUps(useDb(), viewer.facilityId, todayIso(), viewer.role)
})
