import { formIdParams } from '../../../../schemas'
import { reopenTalkForm } from '../../../../services/staffTalks'

/** „Wieder öffnen“: a submitted self form is open to the employee again. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  reopenTalkForm(useDb(), admin.facilityId, formId)
  return { ok: true }
})
