import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { deleteGroup, facilityOfGroup } from '../../services/groups'

/**
 * The Träger deletes a group of any facility (not only the active one). `autoLeaveSwitchedOff`: deleting a group for
 * school children switched the automatic leaving of its facility off.
 */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  const { autoLeaveSwitchedOff } = deleteGroup(db, facilityOfGroup(db, id), id, todayIso())
  return { ok: true, autoLeaveSwitchedOff }
})
