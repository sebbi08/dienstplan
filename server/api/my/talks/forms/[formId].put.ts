import { formAnswersSchema, formIdParams } from '../../../../schemas'
import { saveMyTalkFormAnswers } from '../../../../services/staffTalks'

/** The employee saves their self-assessment while it is released to them (409 form_not_editable otherwise). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { answers } = await readValidatedBody(event, formAnswersSchema.parse)
  saveMyTalkFormAnswers(useDb(), user, formId, answers)
  return { ok: true }
})
