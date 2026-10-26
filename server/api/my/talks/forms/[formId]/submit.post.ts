import { formIdParams, formSubmitSchema } from '../../../../../schemas'
import { submitMyTalkForm } from '../../../../../services/staffTalks'

/** „Abgeben“: the employee submits their released self-assessment. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { expectedUpdatedAt } = await readValidatedBody(event, formSubmitSchema.parse)
  submitMyTalkForm(useDb(), user, formId, expectedUpdatedAt)
  return { ok: true }
})
