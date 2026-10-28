import { contactOrderSchema, idParams } from '../../../../schemas'
import { reorderEmergencyContacts } from '../../../../services/emergencyContacts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, contactOrderSchema.parse)
  reorderEmergencyContacts(useDb(), admin.facilityId, id, body.ids)
  return { ok: true }
})
