import { todayIso } from '../../../../shared/domain/dates'
import { childLeaveSchema, idParams } from '../../../schemas'
import { ageLimitCells, ageLimitWarnings } from '../../../services/ageLimits'
import { capacityCells, capacityWarnings } from '../../../services/capacityWarnings'
import { leaveChild } from '../../../services/children'

/**
 * Registers (or moves) the leaving day. A later day than before lengthens the stay: `capacityWarnings` and
 * `ageLimitWarnings` then name the Höchstzahl Kinder and the group's age limits the added months take over.
 */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { leftOn } = await readValidatedBody(event, childLeaveSchema.parse)
  const db = useDb()
  const today = todayIso()
  const before = capacityCells(db, manager.facilityId, id, today)
  const ageBefore = ageLimitCells(db, manager.facilityId, id, today)
  leaveChild(db, manager.facilityId, id, leftOn, today)
  return {
    ok: true,
    capacityWarnings: capacityWarnings(db, manager, manager.facilityId, id, before, today),
    ageLimitWarnings: ageLimitWarnings(db, manager, manager.facilityId, id, ageBefore, today),
  }
})
