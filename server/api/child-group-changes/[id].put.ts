import { todayIso } from '../../../shared/domain/dates'
import { groupChangeSchema, idParams } from '../../schemas'
import { updateGroupChange } from '../../services/childGroupChanges'

/** Changes a planned group change until the day before it takes effect. */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, groupChangeSchema.parse)
  updateGroupChange(useDb(), manager, manager.facilityId, id, body, todayIso())
  return { ok: true }
})
