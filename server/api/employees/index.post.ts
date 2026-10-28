import { employeeCreateSchema } from '../../schemas'
import { createEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.edit')
  const body = await readValidatedBody(event, employeeCreateSchema.parse)
  return { id: createEmployee(useDb(), actor, actor.facilityId, body) }
})
