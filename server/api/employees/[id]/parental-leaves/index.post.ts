import { idParams, parentalLeaveSchema } from '../../../../schemas'
import { createParentalLeave } from '../../../../services/parentalLeave'

/** „Elternzeit eintragen“ for the facility's employee; answers its id and the entries already in the plan then. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.contractEdit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, parentalLeaveSchema.parse)
  return createParentalLeave(useDb(), admin, admin.facilityId, id, input)
})
