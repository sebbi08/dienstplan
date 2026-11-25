import { idParams, visitFormCreateSchema } from '../../../schemas'
import { createVisitForm } from '../../../services/visits'

/** A new form of the applicant from a template of the kind „Hospitation“. */
export default defineServiceHandler(async (event): Promise<{ id: number }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { templateId } = await readValidatedBody(event, visitFormCreateSchema.parse)
  return { id: createVisitForm(useDb(), actor, 'applicant', id, templateId) }
})
