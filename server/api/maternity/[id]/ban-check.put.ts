import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { checkMaternityBan } from '../../../services/maternity'

/** „Beschäftigungsverbot geprüft“: ends the reminder to check a ban for the case (today). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  checkMaternityBan(useDb(), scope, id, todayIso())
  return { ok: true }
})
