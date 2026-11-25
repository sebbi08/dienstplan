import { idParams, visitFormCreateSchema } from '../../../schemas'
import { createVisitForm } from '../../../services/visits'

/** A new form of the info visit from a template of the kind „Infogespräch“. */
export default defineServiceHandler(async (event): Promise<{ id: number }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { templateId } = await readValidatedBody(event, visitFormCreateSchema.parse)
  return { id: createVisitForm(useDb(), actor, 'info', id, templateId) }
})
