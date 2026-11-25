import type { ApplicantVisitListItemDto } from '../../../shared/types/api'
import { listApplicants } from '../../services/visits'

/** The facility's applicants (visits.manage includes the view; a Gruppenleitung may get it alone). */
export default defineServiceHandler(async (event): Promise<ApplicantVisitListItemDto[]> => {
  const actor = await requirePermission(event, 'visits.applicants.view')
  return listApplicants(useDb(), actor)
})
