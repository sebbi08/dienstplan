import { idParams } from '../../schemas'
import { deleteEmergencyContact } from '../../services/emergencyContacts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEmergencyContact(useDb(), admin.facilityId, id)
  return { ok: true }
})
