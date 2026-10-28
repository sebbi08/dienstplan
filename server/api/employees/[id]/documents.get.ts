import { idParams } from '../../../schemas'
import { listEmployeeDocuments } from '../../../services/employeeDocuments'

/** The personnel file's documents; the service shows only the folders the actor's keys open (employees.docs.*). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listEmployeeDocuments(useDb(), actor, actor.facilityId, id)
})
