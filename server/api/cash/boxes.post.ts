import { cashBoxSchema } from '../../schemas'
import { createBox } from '../../services/cashBoxes'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, cashBoxSchema.parse)
  return { id: createBox(useDb(), admin, admin.facilityId, body) }
})
