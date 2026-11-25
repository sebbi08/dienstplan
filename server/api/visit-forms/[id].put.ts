import { formAnswersSchema, idParams } from '../../schemas'
import { saveVisitForm } from '../../services/visits'

/** Saves the answers of a visit's form (409 form_changed when someone saved in between). */
export default defineServiceHandler(async (event): Promise<{ updatedAt: string; updatedBy: string }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, formAnswersSchema.parse)
  return saveVisitForm(useDb(), actor, id, body)
})
