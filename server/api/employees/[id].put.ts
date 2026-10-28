import { checkpointWal } from '../../db/client'
import { employeeUpdateSchema, idParams } from '../../schemas'
import { updateEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, employeeUpdateSchema.parse)
  // The personnel file blocks need their own keys (403 from the service).
  updateEmployee(useDb(), admin.facilityId, id, body, admin.permissions, undefined, admin.employeeId)
  // Replaced or cleared personal and sensitive values leave the WAL file at once, as with the documents.
  if (body.personal || body.sensitive) checkpointWal(useSqlite())
  return { ok: true }
})
