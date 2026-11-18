import type { AgeLimitRuleDto } from '../../../../shared/types/api'
import { idParams } from '../../../schemas'
import { listGroupAgeLimits } from '../../../services/ageLimits'

/** The age limits of a group of the facility, for whoever sees the group settings (Leitung and Träger). */
export default defineServiceHandler(async (event): Promise<AgeLimitRuleDto[]> => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listGroupAgeLimits(useDb(), admin.facilityId, id)
})
