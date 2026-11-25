import type { InfoVisitListItemDto } from '../../../shared/types/api'
import { listInfoVisits } from '../../services/visits'

/** The facility's info visits (Mehr → Infogespräche & Hospitationen). */
export default defineServiceHandler(async (event): Promise<InfoVisitListItemDto[]> => {
  const actor = await requirePermission(event, 'visits.manage')
  return listInfoVisits(useDb(), actor)
})
