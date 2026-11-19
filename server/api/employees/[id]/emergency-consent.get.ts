import { idParams } from '../../../schemas'
import { getEmployeeEmergencyConsent } from '../../../services/staffEmergencyConsent'

export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeEmergencyConsent(useDb(), viewer.facilityId, id)
})
