import { employeeCreateSchema } from '../../schemas'
import { createEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidatedBody(event, employeeCreateSchema.parse)
  return { id: createEmployee(useDb(), body) }
})
