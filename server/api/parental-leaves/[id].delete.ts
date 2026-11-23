import { idParams } from '../../schemas'
import { deleteParentalLeave } from '../../services/parentalLeave'

/** Deletes an Elternzeit entered by mistake. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.contractEdit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteParentalLeave(useDb(), admin.facilityId, id)
  return { ok: true }
})
