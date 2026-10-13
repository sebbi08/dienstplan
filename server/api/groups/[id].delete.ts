import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { deleteGroup, facilityOfGroup } from '../../services/groups'

/**
 * The Träger deletes a group of any facility (not only the active one). `autoLeave` is the automatic leaving of the
 * group's facility afterwards: deleting a group for school children switches it off.
 */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  const { autoLeave } = deleteGroup(db, facilityOfGroup(db, id), id, todayIso())
  return { ok: true, autoLeave }
})
