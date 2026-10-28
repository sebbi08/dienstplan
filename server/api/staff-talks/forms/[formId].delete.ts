import { formIdParams } from '../../../schemas'
import { deleteTalkForm } from '../../../services/staffTalks'

/** Removes a form from its talk. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  deleteTalkForm(useDb(), scope, formId)
  return { ok: true }
})
