import { consentQuestionSchema, idParams } from '../../schemas'
import { updateConsentQuestion } from '../../services/childConsents'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateConsentQuestion(useDb(), admin.facilityId, id, await readValidatedBody(event, consentQuestionSchema.parse))
})
