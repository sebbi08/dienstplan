import { employeeUpdateSchema, idParams } from '../../schemas'
import { updateEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  // The personnel file blocks need their own keys (403 from the service).
  updateEmployee(useDb(), admin.facilityId, id, await readValidatedBody(event, employeeUpdateSchema.parse), admin.permissions)
  return { ok: true }
})
