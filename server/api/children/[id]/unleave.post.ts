import { todayIso } from '../../../../shared/domain/dates'
import { childUnleaveSchema, idParams } from '../../../schemas'
import { ageLimitCells, ageLimitWarnings } from '../../../services/ageLimits'
import { capacityCells, capacityWarnings } from '../../../services/capacityWarnings'
import { unleaveChild } from '../../../services/children'

/**
 * Takes a leaving back. The body may be left out; `schoolStartDate` is the new school start a child needs that the
 * facility's automatic leaving would deregister again at once (400 school_start_required without it).
 * `capacityWarnings` names the group and the facility the child then takes over their Höchstzahl Kinder,
 * `ageLimitWarnings` the group's age limits it then takes over in the coming twelve months.
 */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { schoolStartDate } = await readValidatedBody(event, body => childUnleaveSchema.parse(body ?? {}))
  const db = useDb()
  const today = todayIso()
  const before = capacityCells(db, manager.facilityId, id, today)
  const ageBefore = ageLimitCells(db, manager.facilityId, id, today)
  unleaveChild(db, manager.facilityId, id, today, schoolStartDate)
  return {
    ok: true,
    capacityWarnings: capacityWarnings(db, manager, manager.facilityId, id, before, today),
    ageLimitWarnings: ageLimitWarnings(db, manager, manager.facilityId, id, ageBefore, today),
  }
})
