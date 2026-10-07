import { facilityNameSchema, idParams } from '../../schemas'
import { renameFacility } from '../../services/facilities'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { name } = await readValidatedBody(event, facilityNameSchema.parse)
  renameFacility(useDb(), id, name)
  return { ok: true }
})
