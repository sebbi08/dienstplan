import { idParams, moveSchema } from '../../../../schemas'
import { moveBox } from '../../../../services/cashBoxes'

/** Moves an active box of the active facility one place up or down within its scope (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveBox(useDb(), admin.facilityId, id, direction)
  return { ok: true }
})
