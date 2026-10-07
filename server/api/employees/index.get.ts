import { todayIso } from '../../../shared/domain/dates'
import { listEmployees } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const viewer = await requireAdmin(event)
  return listEmployees(useDb(), viewer.facilityId, todayIso(), viewer.role)
})
