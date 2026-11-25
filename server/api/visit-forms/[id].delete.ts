import { idParams } from '../../schemas'
import { deleteVisitForm } from '../../services/visits'

/** Deletes a form of an open visit. */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteVisitForm(useDb(), actor, id)
  return { ok: true }
})
