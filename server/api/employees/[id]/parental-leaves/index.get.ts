import { idParams } from '../../../../schemas'
import { getEmployeeParentalLeave } from '../../../../services/parentalLeave'

/** The section „Elternzeit“ of the employee page (contract data): the periods, the children to choose from, the moved level step. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.contractView')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeParentalLeave(useDb(), admin, admin.facilityId, id)
})
