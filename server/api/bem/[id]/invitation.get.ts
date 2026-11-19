import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { bemInvitation } from '../../../services/bem'

/** The BEM invitation to print; the employee's address only with employees.personal. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return bemInvitation(useDb(), admin, scope, id, todayIso())
})
