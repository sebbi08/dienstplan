import { idParams } from '../../schemas'
import { deleteConsentQuestion } from '../../services/childConsents'

/** Only a question no child has answered (409 consent_question_answered: hide it instead). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteConsentQuestion(useDb(), admin.facilityId, id)
  return { ok: true }
})
