import { formIdParams } from '../../../../schemas'
import { releaseTalkForm } from '../../../../services/staffTalks'

/** „Zum Ausfüllen freigeben“ (a self form in draft goes to the employee). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  releaseTalkForm(useDb(), admin.facilityId, formId)
  return { ok: true }
})
