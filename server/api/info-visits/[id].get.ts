import type { InfoVisitDto } from '../../../shared/types/api'
import { idParams } from '../../schemas'
import { getInfoVisit } from '../../services/visits'

/** One info visit with documents, forms, templates and staff. */
export default defineServiceHandler(async (event): Promise<InfoVisitDto> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getInfoVisit(useDb(), actor, id)
})
