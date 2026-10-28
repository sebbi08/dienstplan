import { idParams } from '../../../schemas'
import { deleteBox } from '../../../services/cashBoxes'

/** Deletes a box without entries (409 cash_box_has_entries otherwise: archive it instead). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.book')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteBox(useDb(), admin.facilityId, id)
  return { ok: true }
})
