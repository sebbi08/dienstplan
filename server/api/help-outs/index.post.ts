import { helpOutSchema } from '../../schemas'
import { addHelpOut } from '../../services/helpOuts'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return { id: addHelpOut(useDb(), admin.facilityId, await readValidatedBody(event, helpOutSchema.parse)) }
})
