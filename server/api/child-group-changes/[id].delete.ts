import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { deleteGroupChange } from '../../services/childGroupChanges'

/** Deletes a planned group change until the day before it takes effect. */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteGroupChange(useDb(), manager.facilityId, id, todayIso())
  return { ok: true }
})
