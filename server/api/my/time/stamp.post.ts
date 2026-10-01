import { stampSchema } from '../../../schemas'
import { stamp } from '../../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  if (user.employeeId === null) throw createError({ statusCode: 403, statusMessage: 'no_employee', data: { code: 'no_employee' } })
  const { action } = await readValidatedBody(event, stampSchema.parse)
  return stamp(useDb(), user.employeeId, action, 'self')
})
