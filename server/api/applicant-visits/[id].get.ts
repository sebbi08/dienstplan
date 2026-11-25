import type { ApplicantVisitDto } from '../../../shared/types/api'
import { idParams } from '../../schemas'
import { getApplicant } from '../../services/visits'

/** One applicant with days, documents and forms (`canManage` for visits.manage). */
export default defineServiceHandler(async (event): Promise<ApplicantVisitDto> => {
  const actor = await requirePermission(event, 'visits.applicants.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getApplicant(useDb(), actor, id)
})
