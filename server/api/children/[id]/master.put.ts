import { todayIso } from '../../../../shared/domain/dates'
import { childMasterSchema, idParams } from '../../../schemas'
import { capacityCells, capacityWarnings } from '../../../services/capacityWarnings'
import { updateChildMaster } from '../../../services/children'

/** Saves the master data; `capacityWarnings` names what a new group or a contract takes over its Höchstzahl Kinder. */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childMasterSchema.parse)
  const db = useDb()
  const today = todayIso()
  const before = capacityCells(db, actor.facilityId, id, today)
  updateChildMaster(db, actor, actor.facilityId, id, body, today)
  return { ok: true, capacityWarnings: capacityWarnings(db, actor, actor.facilityId, id, before, today) }
})
