import { todayIso } from '../../../shared/domain/dates'
import type { AgeLimitWarningDto } from '../../../shared/types/api'
import { upcomingAgeLimitWarnings } from '../../services/ageLimits'

/** The hint on the Kinder page: the groups' age limits exceeded in the coming twelve months (first month per rule). */
export default defineServiceHandler(async (event): Promise<AgeLimitWarningDto[]> => {
  const manager = await requireChildPermission(event, 'children.manage')
  return upcomingAgeLimitWarnings(useDb(), manager.facilityId, todayIso())
})
