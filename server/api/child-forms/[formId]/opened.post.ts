import { formIdParams } from '../../../schemas'
import { markChildFormOpened } from '../../../services/childFormHistory'

/** Records that the viewer opened the observation form (for the marker „neu seit dem letzten Öffnen“). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  markChildFormOpened(useDb(), viewer, formId)
  return { ok: true }
})
