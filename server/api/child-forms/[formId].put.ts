import { childFormSaveSchema, formIdParams } from '../../schemas'
import { saveChildForm } from '../../services/childForms'

/** Saves header and answers of an observation form; the service checks the edit right on this form. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const body = await readValidatedBody(event, childFormSaveSchema.parse)
  return saveChildForm(useDb(), viewer, formId, body)
})
