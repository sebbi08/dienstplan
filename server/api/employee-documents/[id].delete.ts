import { checkpointWal } from '../../db/client'
import { idParams } from '../../schemas'
import { deleteEmployeeDocument } from '../../services/employeeDocuments'

export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEmployeeDocument(useDb(), actor, actor.facilityId, id)
  // The bytes leave the WAL file at once, as with the child documents.
  checkpointWal(useSqlite())
  return { ok: true }
})
