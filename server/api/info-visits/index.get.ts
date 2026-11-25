import type { InfoVisitListItemDto } from '../../../shared/types/api'
import { listInfoVisits } from '../../services/visits'

/** The facility's info visits (Kinder → Planung → Infogespräche). */
export default defineServiceHandler(async (event): Promise<InfoVisitListItemDto[]> => {
  const actor = await requirePermission(event, 'visits.manage')
  return listInfoVisits(useDb(), actor)
})
