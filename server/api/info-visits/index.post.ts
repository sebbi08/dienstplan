import { infoVisitSchema } from '../../schemas'
import { createInfoVisit } from '../../services/visits'

/** A new info visit; the service checks the fields (German codes). */
export default defineServiceHandler(async (event): Promise<{ id: number }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const body = await readValidatedBody(event, infoVisitSchema.parse)
  return { id: createInfoVisit(useDb(), actor, body) }
})
