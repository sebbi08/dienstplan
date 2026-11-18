import type { AgeLimitRuleDto } from '../../../../shared/types/api'
import { groupAgeLimitsSchema, idParams } from '../../../schemas'
import { listGroupAgeLimits, setGroupAgeLimits } from '../../../services/ageLimits'

/**
 * Whoever edits the groups (the Träger by default) replaces the age limits of a group of the facility; 400 with a
 * German code for an invalid rule. Answers the list as stored.
 */
export default defineServiceHandler(async (event): Promise<AgeLimitRuleDto[]> => {
  const provider = await requirePermission(event, 'settings.groups')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { rules } = await readValidatedBody(event, groupAgeLimitsSchema.parse)
  const db = useDb()
  setGroupAgeLimits(db, provider.facilityId, id, rules)
  return listGroupAgeLimits(db, provider.facilityId, id)
})
