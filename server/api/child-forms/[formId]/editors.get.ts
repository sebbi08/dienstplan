import { formIdParams } from '../../../schemas'
import { listChildFormEditors } from '../../../services/childForms'

/** The employees unlocked for the form (Leitung and Träger; checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  return listChildFormEditors(useDb(), viewer, formId)
})
