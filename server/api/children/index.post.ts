import { todayIso } from '../../../shared/domain/dates'
import { childCreateSchema } from '../../schemas'
import { capacityWarnings } from '../../services/capacityWarnings'
import { createChild } from '../../services/children'

/** Creates a child; `capacityWarnings` names the groups and the facility it takes over their Höchstzahl Kinder. */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildEditor(event)
  const body = await readValidatedBody(event, childCreateSchema.parse)
  const db = useDb()
  const id = createChild(db, actor, actor.facilityId, body)
  return { id, capacityWarnings: capacityWarnings(db, actor, actor.facilityId, id, new Set(), todayIso()) }
})
