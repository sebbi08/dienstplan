import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { getEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployee(useDb(), viewer.facilityId, id, todayIso(), viewer.role)
})
