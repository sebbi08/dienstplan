import { idParams } from '../../../schemas'
import { clearBemNotes } from '../../../services/bem'

/** „Gesprächsnotizen löschen“ of a declined BEM (consent withdrawn): clears the texts of its talks and measures. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.sickness')
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return { cleared: clearBemNotes(useDb(), scope, id) }
})
