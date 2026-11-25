import { applicantVisitSchema, idParams } from '../../schemas'
import { updateApplicant } from '../../services/visits'

/** Changes an applicant not hired (409 visit_transferred): fields, days and status (declining sets the day of the refusal). */
export default defineServiceHandler(async (event): Promise<{ ok: true }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, applicantVisitSchema.parse)
  updateApplicant(useDb(), actor, id, body)
  return { ok: true }
})
