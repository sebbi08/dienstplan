import { emergencyContactSchema, idParams } from '../../../schemas'
import { addEmergencyContact } from '../../../services/emergencyContacts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, emergencyContactSchema.parse)
  return { id: addEmergencyContact(useDb(), admin.facilityId, id, body) }
})
