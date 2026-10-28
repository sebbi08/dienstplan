import { helpOutSchema } from '../../schemas'
import { addHelpOut } from '../../services/helpOuts'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'plan.edit')
  return { id: addHelpOut(useDb(), admin.facilityId, await readValidatedBody(event, helpOutSchema.parse)) }
})
