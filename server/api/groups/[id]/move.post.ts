import { idParams, moveSchema } from '../../../schemas'
import { moveGroup } from '../../../services/groups'

/** The Träger moves a group of the facility they work in one place up or down (404 for another facility's group). */
export default defineServiceHandler(async (event) => {
  const provider = await requireProvider(event)
  const facilityId = requireFacility(event, provider)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveGroup(useDb(), facilityId, id, direction)
  return { ok: true }
})
