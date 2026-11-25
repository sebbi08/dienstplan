import { applicantVisitSchema } from '../../schemas'
import { createApplicant } from '../../services/visits'

/** A new applicant with its days; the service checks the fields (German codes). */
export default defineServiceHandler(async (event): Promise<{ id: number }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const body = await readValidatedBody(event, applicantVisitSchema.parse)
  return { id: createApplicant(useDb(), actor, body) }
})
