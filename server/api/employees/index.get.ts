import { todayIso } from '../../../shared/domain/dates'
import { listEmployees } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listEmployees(useDb(), todayIso())
})
