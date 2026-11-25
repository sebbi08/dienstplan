import { idParams, infoVisitSchema } from '../../schemas'
import { updateInfoVisit } from '../../services/visits'

/** Changes an info visit not taken over (409 visit_transferred), also its status (open / declined). */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, infoVisitSchema.parse)
  updateInfoVisit(useDb(), actor, id, body)
  return { ok: true }
})
