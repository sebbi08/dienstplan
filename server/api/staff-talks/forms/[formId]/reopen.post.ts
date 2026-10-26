import { formIdParams } from '../../../../schemas'
import { reopenTalkForm } from '../../../../services/staffTalks'

/** „Wieder öffnen“: a submitted self form is open to the employee again. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  reopenTalkForm(useDb(), scope, formId)
  return { ok: true }
})
