import { formIdParams } from '../../schemas'
import { getChildForm } from '../../services/childForms'

/** One observation form with content, answers, the viewer's right and the printout's header. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return getChildForm(useDb(), viewer, formId)
})
