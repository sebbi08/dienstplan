import type { VisitFormDto } from '../../../shared/types/api'
import { idParams } from '../../schemas'
import { getVisitForm } from '../../services/visits'

/** A form of a visit (an info visit's needs visits.manage, checked by the service). */
export default defineServiceHandler(async (event): Promise<VisitFormDto> => {
  const actor = await requirePermission(event, 'visits.applicants.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getVisitForm(useDb(), actor, id)
})
