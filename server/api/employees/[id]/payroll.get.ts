import { idParams } from '../../../schemas'
import { getPayroll } from '../../../services/employeePayroll'

/** Lohn und Steuer of the facility's employee, in full (masked by the page); only with employees.payroll. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.payroll')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getPayroll(useDb(), actor.facilityId, id)
})
