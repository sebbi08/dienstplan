import { formIdParams } from '../../schemas'
import { deleteChildForm } from '../../services/childForms'

/** Deletes an observation form (Leitung and Träger; checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  deleteChildForm(useDb(), viewer, formId)
  return { ok: true }
})
