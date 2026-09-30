import { hoursSchema, idParams } from '../../../schemas'
import { addHours } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  addHours(useDb(), id, await readValidatedBody(event, hoursSchema.parse))
  return { ok: true }
})
