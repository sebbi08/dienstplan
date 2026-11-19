import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { getEmployeeBem } from '../../../services/bem'

/**
 * The BEM part of the employee page: the sick working days counted, the running process and the earlier ones. Health
 * data: employees.sickness, the active facility's employees, never the viewer's own (403 bem_own).
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeBem(useDb(), scope, id, todayIso())
})
