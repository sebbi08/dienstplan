import { idParams } from '../../../../schemas'
import { unlockPin } from '../../../../services/terminal'

/** „PIN freischalten“: the Leitung or the Träger ends the PIN lock of an employee of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  unlockPin(useDb(), admin.facilityId, id)
  return { ok: true }
})
