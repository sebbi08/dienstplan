import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { getPayrollView } from '../../../services/employeePayroll'

/**
 * Lohn und Steuer of the facility's employee, in full (masked by the page), with the parent status from the children
 * (Pflegeversicherung, read-only); only with employees.payroll.
 */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.payroll')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getPayrollView(useDb(), actor.facilityId, id, todayIso())
})
