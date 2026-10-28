import { formIdParams } from '../../../../schemas'
import { withdrawTalkForm } from '../../../../services/staffTalks'

/** Takes the release of a self form back while it is not submitted. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  withdrawTalkForm(useDb(), scope, formId)
  return { ok: true }
})
