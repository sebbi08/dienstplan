import { idParams, pinSchema } from '../../../schemas'
import { assertEmployee } from '../../../services/employees'
import { setPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { pin } = await readValidatedBody(event, pinSchema.parse)
  assertEmployee(useDb(), admin.facilityId, id)
  setPin(useDb(), id, pin)
  return { ok: true }
})
