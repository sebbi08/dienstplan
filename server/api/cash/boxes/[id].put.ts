import { cashBoxUpdateSchema, idParams } from '../../../schemas'
import { updateBox } from '../../../services/cashBoxes'

/** Renames, changes or archives / reactivates a box of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, cashBoxUpdateSchema.parse)
  updateBox(useDb(), admin, admin.facilityId, id, body)
  return { ok: true }
})
