import { idParams, leaveEntrySchema } from '../../../schemas'
import { enterLeave } from '../../../services/leaveEntries'

/** „Urlaub eintragen“: as editing the plan (plan.edit); the service checks the facility and the own employee. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return enterLeave(useDb(), admin, admin.facilityId, id, await readValidatedBody(event, leaveEntrySchema.parse))
})
