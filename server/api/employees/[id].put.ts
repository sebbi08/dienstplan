import { employeeUpdateSchema, idParams } from '../../schemas'
import { updateEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEmployee(useDb(), id, await readValidatedBody(event, employeeUpdateSchema.parse))
  return { ok: true }
})
