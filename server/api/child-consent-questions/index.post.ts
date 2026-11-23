import { consentQuestionSchema } from '../../schemas'
import { createConsentQuestion } from '../../services/childConsents'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return createConsentQuestion(useDb(), admin.facilityId, await readValidatedBody(event, consentQuestionSchema.parse))
})
