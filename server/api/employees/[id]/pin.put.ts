import { idParams, pinSchema } from '../../../schemas'
import { setPin } from '../../../services/terminal'
import { assertPinManageable } from '../../../services/users'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { pin } = await readValidatedBody(event, pinSchema.parse)
  assertPinManageable(useDb(), admin, id)
  setPin(useDb(), admin.facilityId, id, pin)
  return { ok: true }
})
