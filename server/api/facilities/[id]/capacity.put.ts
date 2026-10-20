import { facilityCapacitySchema, idParams } from '../../../schemas'
import { setFacilityCapacity } from '../../../services/facilities'

/** The Träger sets the Höchstzahl Kinder of a facility (null = none). */
export default defineServiceHandler(async (event) => {
  const user = await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { capacity } = await readValidatedBody(event, facilityCapacitySchema.parse)
  setFacilityCapacity(useDb(), user, id, capacity)
  return { ok: true }
})
