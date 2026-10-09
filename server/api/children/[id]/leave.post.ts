import { todayIso } from '../../../../shared/domain/dates'
import { childLeaveSchema, idParams } from '../../../schemas'
import { leaveChild } from '../../../services/children'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { leftOn } = await readValidatedBody(event, childLeaveSchema.parse)
  leaveChild(useDb(), admin.facilityId, id, leftOn, todayIso())
  return { ok: true }
})
