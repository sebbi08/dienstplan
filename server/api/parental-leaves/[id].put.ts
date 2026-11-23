import { idParams, parentalLeaveSchema } from '../../schemas'
import { updateParentalLeave } from '../../services/parentalLeave'

/** Changes an Elternzeit of the facility's employee; answers the entries already in the plan then. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.contractEdit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, parentalLeaveSchema.parse)
  return updateParentalLeave(useDb(), admin.facilityId, id, input)
})
