import { formIdParams } from '../../../../schemas'
import { getMyTalkForm } from '../../../../services/staffTalks'

/** One form of the employee's own talk, if it is released to them (404 otherwise). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return getMyTalkForm(useDb(), user, formId)
})
