import { todayIso } from '../../../../shared/domain/dates'
import { idParams } from '../../../schemas'
import { employeeRequiredDocuments } from '../../../services/requiredDocuments'

/** „Pflichtdokumente“ of an employee: the status of each applicable type in a folder the viewer may use. */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return employeeRequiredDocuments(useDb(), viewer, viewer.facilityId, id, todayIso())
})
