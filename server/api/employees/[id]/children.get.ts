import { idParams } from '../../../schemas'
import { getEmployeeChildren } from '../../../services/employeeChildren'

/** The section „Kinder“ of the facility's employee („alleinerziehend“, the children): personal data, employees.personal. */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.personal', { tabletPlanEdit: true })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployeeChildren(useDb(), viewer.facilityId, id)
})
