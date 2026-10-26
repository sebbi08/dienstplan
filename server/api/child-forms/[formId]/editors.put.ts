import { childFormEditorsSchema, formIdParams } from '../../../schemas'
import { setChildFormEditors } from '../../../services/childForms'

/** „Mitarbeiter freischalten“: sets the employees unlocked for the form (Leitung and Träger; checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { employeeIds } = await readValidatedBody(event, childFormEditorsSchema.parse)
  return setChildFormEditors(useDb(), viewer, formId, employeeIds)
})
