import { earlyClosureSchema, idParams } from '../../schemas'
import { updateEarlyClosure } from '../../services/earlyClosures'

export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'closures.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEarlyClosure(useDb(), admin.facilityId, id, await readValidatedBody(event, earlyClosureSchema.parse))
  return { ok: true }
})
