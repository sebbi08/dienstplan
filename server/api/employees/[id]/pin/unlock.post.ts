import { idParams } from '../../../../schemas'
import { unlockPin } from '../../../../services/terminal'
import { assertPinManageable } from '../../../../services/users'

/** „PIN freischalten“: the Leitung or the Träger ends the PIN lock of an employee of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  assertPinManageable(useDb(), admin, admin.facilityId, id)
  unlockPin(useDb(), admin.facilityId, id)
  return { ok: true }
})
