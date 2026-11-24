import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { deleteGroup, facilityOfGroupInReach } from '../../services/groups'

/**
 * Deletes a group: the Träger of any facility (not only the active one), everyone else only of their own (else 404).
 * `autoLeaveSwitchedOff`: deleting a group for school children switched the automatic leaving of its facility off.
 */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'settings.groups', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  const { autoLeaveSwitchedOff } = deleteGroup(db, facilityOfGroupInReach(db, user, id), id, todayIso())
  return { ok: true, autoLeaveSwitchedOff }
})
