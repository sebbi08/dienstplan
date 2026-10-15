import { todayIso } from '../../../../shared/domain/dates'
import { groupChangeSchema, idParams } from '../../../schemas'
import { planGroupChange } from '../../../services/childGroupChanges'

/** Plans a group change of a child of the active facility (applied at once when its day is today or earlier). */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, groupChangeSchema.parse)
  planGroupChange(useDb(), manager, manager.facilityId, id, body, todayIso())
  return { ok: true }
})
