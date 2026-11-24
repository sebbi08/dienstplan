import { formIdParams, formRevisionsQuery } from '../../../../schemas'
import { listChildFormRevisions } from '../../../../services/childFormHistory'

/** „Verlauf“ of an observation form, newest first and paged; whoever may open the form reads it (checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { offset } = await getValidatedQuery(event, formRevisionsQuery.parse)
  return listChildFormRevisions(useDb(), viewer, formId, offset)
})
