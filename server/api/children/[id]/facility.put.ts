import { childFacilitySchema, idParams } from '../../../schemas'
import { moveChildToFacility } from '../../../services/children'

/** The Träger moves a child's record to another facility (the id names the child, wherever it is now). */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { facilityId } = await readValidatedBody(event, childFacilitySchema.parse)
  moveChildToFacility(useDb(), id, facilityId)
  return { ok: true }
})
