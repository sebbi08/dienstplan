import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { getEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // The viewer's own permissions decide the contract data and the personnel file blocks (absent without the key).
  return getEmployee(useDb(), viewer.facilityId, id, todayIso(), viewer.permissions)
})
