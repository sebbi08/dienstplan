import { idParams, leaveEntryRemovalQuery } from '../../../schemas'
import { removeLeave } from '../../../services/leaveEntries'

/** „Entfernen“ of a leave period: as editing the plan (plan.edit); the service checks the facility and the own employee. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return removeLeave(useDb(), admin, admin.facilityId, id, await getValidatedQuery(event, leaveEntryRemovalQuery.parse))
})
