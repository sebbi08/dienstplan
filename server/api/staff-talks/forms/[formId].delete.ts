import { formIdParams } from '../../../schemas'
import { deleteTalkForm } from '../../../services/staffTalks'

/** Removes a form from its talk. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  deleteTalkForm(useDb(), admin.facilityId, formId)
  return { ok: true }
})
