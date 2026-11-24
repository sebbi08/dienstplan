import { formIdParams, formOpenedSchema } from '../../../schemas'
import { markChildFormOpened } from '../../../services/childFormHistory'

/** Records that the viewer opened the observation form, up to the state they loaded (marker „neu seit dem letzten Öffnen“). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { seenUntil } = await readValidatedBody(event, formOpenedSchema.parse)
  markChildFormOpened(useDb(), viewer, formId, seenUntil)
  return { ok: true }
})
