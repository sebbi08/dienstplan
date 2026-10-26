import { formIdParams } from '../../../../schemas'
import { releaseTalkForm } from '../../../../services/staffTalks'

/** „Zum Ausfüllen freigeben“ (a self form in draft goes to the employee). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  releaseTalkForm(useDb(), scope, formId)
  return { ok: true }
})
