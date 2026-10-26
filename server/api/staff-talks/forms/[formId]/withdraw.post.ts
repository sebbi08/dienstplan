import { formIdParams } from '../../../../schemas'
import { withdrawTalkForm } from '../../../../services/staffTalks'

/** Takes the release of a self form back while it is not submitted. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  withdrawTalkForm(useDb(), admin.facilityId, formId)
  return { ok: true }
})
