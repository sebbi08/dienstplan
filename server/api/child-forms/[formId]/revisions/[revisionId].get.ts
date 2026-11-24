import { formRevisionParams } from '../../../../schemas'
import { getChildFormRevision } from '../../../../services/childFormHistory'

/** One stored state of an observation form („Stand vom …“); whoever may open the form reads it (checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { formId, revisionId } = await getValidatedRouterParams(event, formRevisionParams.parse)
  return getChildFormRevision(useDb(), viewer, formId, revisionId)
})
