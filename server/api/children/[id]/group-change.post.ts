import { todayIso } from '../../../../shared/domain/dates'
import { groupChangeSchema, idParams } from '../../../schemas'
import { ageLimitCells, ageLimitWarnings } from '../../../services/ageLimits'
import { capacityCells, capacityWarnings } from '../../../services/capacityWarnings'
import { planGroupChange } from '../../../services/childGroupChanges'

/**
 * Plans a group change of a child of the active facility (applied at once when its day is today or earlier);
 * `capacityWarnings` names the group it takes over its Höchstzahl Kinder, `ageLimitWarnings` the group's age limits
 * it takes over in the coming twelve months.
 */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, groupChangeSchema.parse)
  const db = useDb()
  const today = todayIso()
  const before = capacityCells(db, manager.facilityId, id, today)
  const ageBefore = ageLimitCells(db, manager.facilityId, id, today)
  planGroupChange(db, manager, manager.facilityId, id, body, today)
  return {
    ok: true,
    capacityWarnings: capacityWarnings(db, manager, manager.facilityId, id, before, today),
    ageLimitWarnings: ageLimitWarnings(db, manager, manager.facilityId, id, ageBefore, today),
  }
})
