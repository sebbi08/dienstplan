import { idParams } from '../../../schemas'
import { deleteStay } from '../../../services/childAttendance'

/** Deletes a stay that was stamped by mistake. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteStay(useDb(), viewer, id)
  return { ok: true }
})
