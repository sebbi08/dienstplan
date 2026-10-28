import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { getEmployeeRequirements } from '../../../services/requirements'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeRequirements(useDb(), admin.facilityId, id, todayIso())
})
