import { formIdParams } from '../../../../../schemas'
import { submitMyTalkForm } from '../../../../../services/staffTalks'

/** „Abgeben“: the employee submits their released self-assessment. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  submitMyTalkForm(useDb(), user, formId)
  return { ok: true }
})
