import { emergencyConsentSchema, idParams } from '../../../schemas'
import { setEmployeeEmergencyConsent } from '../../../services/staffEmergencyConsent'

/** Leitung and Träger record a written consent (with its day) or its withdrawal; the employee's own withdrawal wins. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, emergencyConsentSchema.parse)
  return setEmployeeEmergencyConsent(useDb(), admin, admin.facilityId, id, body)
})
