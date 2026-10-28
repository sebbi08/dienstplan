import { emergencyContactSchema, idParams } from '../../schemas'
import { updateEmergencyContact } from '../../services/emergencyContacts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEmergencyContact(useDb(), admin.facilityId, id, await readValidatedBody(event, emergencyContactSchema.parse))
  return { ok: true }
})
