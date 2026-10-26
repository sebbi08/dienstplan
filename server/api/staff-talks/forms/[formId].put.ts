import { formAnswersSchema, formIdParams } from '../../../schemas'
import { saveTalkFormAnswers } from '../../../services/staffTalks'

/** Saves the answers of a talk's form (Leitung and Träger, in any state). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { answers, expectedUpdatedAt } = await readValidatedBody(event, formAnswersSchema.parse)
  saveTalkFormAnswers(useDb(), admin, admin.facilityId, formId, answers, expectedUpdatedAt)
  return { ok: true }
})
