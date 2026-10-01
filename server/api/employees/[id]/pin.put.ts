import { idParams, pinSchema } from '../../../schemas'
import { setPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { pin } = await readValidatedBody(event, pinSchema.parse)
  setPin(useDb(), id, pin)
  return { ok: true }
})
