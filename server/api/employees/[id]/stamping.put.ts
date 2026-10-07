import { idParams, stampingSchema } from '../../../schemas'
import { setStampingOptions } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  setStampingOptions(useDb(), admin.facilityId, id, await readValidatedBody(event, stampingSchema.parse))
  return { ok: true }
})
