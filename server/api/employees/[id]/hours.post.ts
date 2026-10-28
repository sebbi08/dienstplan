import { hoursSchema, idParams } from '../../../schemas'
import { addHours } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  addHours(useDb(), admin.facilityId, id, await readValidatedBody(event, hoursSchema.parse), admin)
  return { ok: true }
})
