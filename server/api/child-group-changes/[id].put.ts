import { todayIso } from '../../../shared/domain/dates'
import { groupChangeSchema, idParams } from '../../schemas'
import { capacityCells, capacityWarnings } from '../../services/capacityWarnings'
import { childOfGroupChange, updateGroupChange } from '../../services/childGroupChanges'

/** Changes a planned group change until the day before it takes effect, with the capacity hint as when planning. */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, groupChangeSchema.parse)
  const db = useDb()
  const today = todayIso()
  const childId = childOfGroupChange(db, manager.facilityId, id)
  const before = capacityCells(db, manager.facilityId, childId, today)
  updateGroupChange(db, manager, manager.facilityId, id, body, today)
  // The update found the change, so its child is known.
  return { ok: true, capacityWarnings: capacityWarnings(db, manager, manager.facilityId, childId!, before, today) }
})
