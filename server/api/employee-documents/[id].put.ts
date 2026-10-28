import { employeeDocumentSchema, idParams } from '../../schemas'
import { updateEmployeeDocument } from '../../services/employeeDocuments'

/** Folder, title, date and note; moving needs the keys of both folders (service). */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEmployeeDocument(useDb(), actor, actor.facilityId, id, await readValidatedBody(event, employeeDocumentSchema.parse))
  return { ok: true }
})
