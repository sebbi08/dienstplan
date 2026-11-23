import { idOrderSchema } from '../../schemas'
import { reorderConsentQuestions } from '../../services/childConsents'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { ids } = await readValidatedBody(event, idOrderSchema.parse)
  reorderConsentQuestions(useDb(), admin.facilityId, ids)
  return { ok: true }
})
