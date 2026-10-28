import { cashBoxSchema } from '../../schemas'
import { createBox } from '../../services/cashBoxes'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'cash.book')
  const body = await readValidatedBody(event, cashBoxSchema.parse)
  return { id: createBox(useDb(), admin, admin.facilityId, body) }
})
