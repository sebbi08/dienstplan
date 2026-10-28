import { idParams } from '../../../schemas'
import { listEmergencyContacts } from '../../../services/emergencyContacts'

export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listEmergencyContacts(useDb(), viewer.facilityId, id)
})
