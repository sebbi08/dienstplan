import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { capacityCells, capacityWarnings } from '../../services/capacityWarnings'
import { childOfGroupChange, deleteGroupChange } from '../../services/childGroupChanges'

/**
 * Deletes a planned group change until the day before it takes effect; `capacityWarnings` names the group the child
 * then stays in longer when that takes it over its Höchstzahl Kinder.
 */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  const today = todayIso()
  const childId = childOfGroupChange(db, manager.facilityId, id)
  const before = capacityCells(db, manager.facilityId, childId, today)
  deleteGroupChange(db, manager.facilityId, id, today)
  // The delete found the change, so its child is known.
  return { ok: true, capacityWarnings: capacityWarnings(db, manager, manager.facilityId, childId!, before, today) }
})
