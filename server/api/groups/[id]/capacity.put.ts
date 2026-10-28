import { groupCapacitySchema, idParams } from '../../../schemas'
import { setGroupCapacity } from '../../../services/groups'

/** The Leitung (or Träger) of the facility sets the number of places of one of its groups. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { capacity } = await readValidatedBody(event, groupCapacitySchema.parse)
  setGroupCapacity(useDb(), admin.facilityId, id, capacity)
  return { ok: true }
})
