import { employeeUpdateSchema, idParams } from '../../schemas'
import { updateEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEmployee(useDb(), admin.facilityId, id, await readValidatedBody(event, employeeUpdateSchema.parse))
  return { ok: true }
})
