import { todayIso } from '../../../shared/domain/dates'
import { childCreateSchema } from '../../schemas'
import { ageLimitWarnings } from '../../services/ageLimits'
import { capacityWarnings } from '../../services/capacityWarnings'
import { createChild } from '../../services/children'

/**
 * Creates a child; `capacityWarnings` names the groups and the facility it takes over their Höchstzahl Kinder,
 * `ageLimitWarnings` the age limits of a group it takes over in the coming twelve months.
 */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const body = await readValidatedBody(event, childCreateSchema.parse)
  const db = useDb()
  const id = createChild(db, actor, actor.facilityId, body)
  const today = todayIso()
  return {
    id,
    capacityWarnings: capacityWarnings(db, actor, actor.facilityId, id, new Set(), today),
    ageLimitWarnings: ageLimitWarnings(db, actor, actor.facilityId, id, new Set(), today),
  }
})
