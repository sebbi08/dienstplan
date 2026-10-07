import { idParams, pinSchema } from '../../../schemas'
import { setPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { pin } = await readValidatedBody(event, pinSchema.parse)
  setPin(useDb(), admin.facilityId, id, pin)
  return { ok: true }
})
