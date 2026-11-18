import { formIdParams } from '../../schemas'
import { getChildAccident } from '../../services/accidents'

/** One accident report about a child with content, answers, attachments and the viewer's right. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return getChildAccident(useDb(), viewer, formId)
})
