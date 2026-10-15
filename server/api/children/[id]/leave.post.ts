import { todayIso } from '../../../../shared/domain/dates'
import { childLeaveSchema, idParams } from '../../../schemas'
import { leaveChild } from '../../../services/children'

export default defineServiceHandler(async (event) => {
  const manager = await requireChildManager(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { leftOn } = await readValidatedBody(event, childLeaveSchema.parse)
  leaveChild(useDb(), manager.facilityId, id, leftOn, todayIso())
  return { ok: true }
})
